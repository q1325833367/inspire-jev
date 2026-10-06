import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {browserAdapter} from '../src/browser-adapter.mjs';
import {run,resume} from '../src/core.mjs';
import {randomUUID} from 'node:crypto';
import {acquire,recoverLock} from '../src/locks.mjs';
import {Agent} from '../src/agent.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function fixture(html,work){
  const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(origin);
  const tab={id:randomUUID(),playwright:page,url:async()=>page.url(),back:()=>page.goBack()},adapter=browserAdapter(tab,{driver:'playwright',instanceId:randomUUID()});
  try{await work({page,tab,adapter,origin});}finally{await browser.close();await new Promise(r=>server.close(r));}
}
const task=(origin,checks)=>({goal:'验证实际控件状态',allowedOrigins:[origin],subgoals:[{id:'stage',goal:'设置要求的状态',checks}],completionChecks:[{kind:'evidence',subgoal:'stage'}]});

test('宿主可使用观测定位信息采集同一目标，动作仍只接受新鲜ref',async()=>fixture('<a href="/book">现场书目</a>',async({adapter})=>{
 const observed=await adapter.observe(),publicPage=adapter.publicView(observed),a=publicPage.actions.find(a=>a.label==='现场书目');assert.ok(a.selector);assert.equal(a.documentId,undefined);assert.equal(a.documentUrl,undefined);assert.equal(a.formGuard,undefined);const extracted=await adapter.extract([{name:'title',selector:a.selector}]);assert.equal(extracted.data.title,'现场书目');assert.ok(adapter.resolveRef(a.ref));await adapter.observe();assert.throws(()=>adapter.resolveRef(a.ref),/过期/);
}));

test('真实 DOM 大页面观测分批继续，保持有限候选',async()=>fixture('<body>'+Array.from({length:5000},(_,i)=>`<p><a href="#${i}">项目 ${i}</a></p>`).join('')+'</body>',async({adapter})=>{
  const first=await adapter.observe();assert.ok(first.coverage.scannedNodes<=500);assert.ok(first.actions.filter(a=>a.selector).length<=120);assert.ok(first.cursor);await adapter.expand(first);const next=await adapter.observe();assert.notEqual(first.cursor.selector,next.cursor.selector);assert.notEqual(first.actions[0].label,next.actions[0].label);
}));
test('SVG 装饰不耗尽业务候选遍历预算',async()=>fixture('<svg><defs>'+Array.from({length:2000},()=>'<path d="M0 0"></path>').join('')+'</defs></svg><button>新建流程</button>',async({adapter})=>{
  const page=await adapter.observe();assert.ok(page.actions.some(a=>a.label==='新建流程'));assert.ok(page.coverage.scannedNodes<=500);
}));
test('可见对话框优先观测，背景控件不进入操作候选',async()=>fixture('<button>背景创建</button><div role="dialog" aria-modal="true"><button>从空白创建</button></div>',async({adapter})=>{
  const p=await adapter.observe();assert.equal(p.coverage.candidateScope,'dialog');assert.ok(p.actions.some(a=>a.label==='从空白创建'));assert.ok(!p.actions.some(a=>a.label==='背景创建'));
}));
test('已知复选框值直接设置，避免反向切换',async()=>fixture('<label><input type="checkbox" checked>允许通知</label>',async({adapter,origin,page})=>{
  const result=await run(task(origin,[{kind:'checked',label:'允许通知',equals:false}]),adapter,{decide:()=>{throw Error('不得为已知状态调用模型');}});assert.equal(result.status,'verified');assert.equal(await page.locator('input').isChecked(),false);assert.equal(result.actions,1);
}));
test('重渲染后的旧目标引用不能写入',async()=>fixture('<label>姓名<input id="name"></label>',async({adapter,page})=>{
  const seen=await adapter.observe(),a=seen.actions.find(a=>a.kind==='fill');await page.locator('input').fill('用户改动');assert.equal((await adapter.validate(a)).reason,'input_changed');await adapter.observe();assert.throws(()=>adapter.resolveRef(a.ref),/过期/);
}));
test('同一物理标签页的不同句柄共享进程锁',async()=>fixture('<button>提交</button>',async({tab,adapter})=>{
  const other=browserAdapter({...tab},{driver:'playwright',instanceId:adapter.identity.split(':tab:')[0].split(':').slice(2).join(':')});assert.equal(adapter.identity,other.identity);
  const release=await acquire(adapter.identity,'first');try{await assert.rejects(acquire(other.identity,'second'),e=>e.code==='TAB_BUSY');await assert.rejects(recoverLock(adapter.identity,{inspected:true}),/存活/);}finally{await release();}
}));
test('动作已执行但确认丢失，恢复先检查实际效果且不重放',async()=>fixture('<form method="post"><button type="submit">提交</button><output id="result"></output></form><script>let count=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("output").textContent=String(++count)}</script>',async({adapter,origin,page})=>{
  const execute=adapter.execute;adapter.execute=async(...args)=>{await execute(...args);throw Error('确认丢失');};const t=task(origin,[{kind:'elementText',selector:'#result',equals:'1'}]);t.subgoals[0].allowSubmit=true;
  const services={decide:async({page})=>({operation:'CLICK',target:page.actions.find(a=>a.label==='提交').id,operationConfidence:1,targetConfidence:1})};
  const first=await run(t,adapter,services);assert.equal(first.reason,'uncertain_action');assert.ok(first.checkpoint.pending);const again=await resume(first.checkpoint,adapter,services);assert.equal(again.status,'verified');assert.equal(again.actions,1);assert.equal(await page.locator('output').textContent(),'1');
}));
test('运行时取消与同调用编号幂等性',async()=>{
  const home=await mkdtemp(join(tmpdir(),'jev-runtime-'));let controller,decisions=0;
  const services={decide:async()=>{decisions++;controller.abort();return{operation:'WAIT',target:'wait',operationConfidence:1,targetConfidence:1};}};
  const agent=await Agent.create({home,host:'contract',modelProxy:null,browserProxy:null,services});
  try{await fixture('<p>未完成</p>',async({adapter,origin})=>{
    const id=randomUUID();agent.sessions.opened.set(id,{adapter,record:{id,allowedOrigins:[origin],status:'open'},release:async()=>{}});controller=new AbortController();const t={...task(origin,[{kind:'text',includes:'不会出现'}]),sessionId:id,requestId:randomUUID()};
    const result=await agent.start(t,{signal:controller.signal});assert.equal(result.status,'cancelled');assert.equal(result.actions,0);const duplicate=await agent.start(t);assert.equal(duplicate.runId,result.runId);assert.equal(decisions,1);await assert.rejects(agent.start({...t,goal:'改变目标'}),/绑定其他任务/);
  });}finally{await agent.shutdown();await rm(home,{recursive:true,force:true});}
});

test('iframe 内原生选择框与复选框使用同一执行核心',async()=>{
 const inner='<label>通知<input type="checkbox" checked></label><label>语言<select><option value="en">English</option><option value="zh">中文</option></select></label>';
 await fixture('<iframe id="inner" srcdoc="'+inner.replaceAll('"','&quot;')+'"></iframe>',async({adapter,origin,page})=>{
  const t=task(origin,[{kind:'selected',frame:'#inner',label:'语言',equals:'中文'}]);t.subgoals.push({id:'notification',goal:'关闭通知',checks:[{kind:'checked',frame:'#inner',label:'通知',equals:false}]});t.completionChecks.push({kind:'evidence',subgoal:'notification'});
  const r=await run(t,adapter,{decide:()=>{throw Error('已知控件值无需 Jev');}});assert.equal(r.status,'verified',JSON.stringify({reason:r.reason,detail:r.detail}));assert.equal(r.actions,2);assert.equal(await page.frameLocator('#inner').locator('select').inputValue(),'zh');
 });
});

test('嵌套滚动区域即使不是遍历末尾的祖先也能发现并操作',async()=>fixture('<div id="scroll" aria-label="结果" style="height:100px;width:250px;overflow-y:auto"><div style="height:1500px"><button>列表项</button></div></div><p>区域外末尾</p>',async({adapter,page})=>{
 const p=await adapter.observe(),a=p.actions.find(a=>a.kind==='scroll'&&a.region);assert.ok(a);await adapter.execute(a);await page.waitForTimeout(200);assert.ok(await page.locator('#scroll').evaluate(e=>e.scrollTop)>0);
}));

test('准备后取消没有发出操作，恢复该检查点只执行一次',async()=>fixture('<label>姓名<input></label>',async({adapter,origin,page})=>{
 const t=task(origin,[{kind:'field',label:'姓名',equals:'给定值'}]);t.inputs={'姓名':'给定值'};const c=new AbortController();let prepared;
 const services={decide:()=>{throw Error('无需决策');}};
 const r=await run(t,adapter,services,{signal:c.signal,saveCheckpoint:async cp=>{if(cp.pending?.phase==='prepared'){prepared=cp;c.abort();}}});assert.equal(r.status,'cancelled');assert.equal(r.actions,0);assert.equal(await page.locator('input').inputValue(),'');
 const resumed=await resume(prepared,adapter,services);assert.equal(resumed.status,'verified');assert.equal(resumed.actions,1);assert.equal(resumed.checkpoint.actions[0].effect,'not_executed');
}));

test('同现场的第二任务及观测不能抢占正在决策的任务',async()=>{
 const home=await mkdtemp(join(tmpdir(),'jev-owner-'));let unblock,entered;const seen=new Promise(r=>entered=r),gate=new Promise(r=>unblock=r);
 const agent=await Agent.create({home,host:'owner',modelProxy:null,browserProxy:null,services:{decide:async({page})=>{entered();await gate;return{operation:'CLICK',target:page.actions.find(a=>a.label==='完成').id,operationConfidence:1,targetConfidence:1};}}});
 try{await fixture('<button onclick="this.textContent=\'已完成\'">完成</button>',async({adapter,origin})=>{
  const id=randomUUID();agent.sessions.opened.set(id,{adapter,record:{id,allowedOrigins:[origin],status:'open'},release:async()=>{}});const t={...task(origin,[{kind:'elementText',selector:'button',equals:'已完成'}]),sessionId:id,requestId:randomUUID()};
  const first=agent.start(t);await seen;const observation=await agent.call('jev_session',{action:'inspect',sessionId:id});assert.equal(observation.reason,'TAB_BUSY');const second=await agent.start({...t,requestId:randomUUID()});assert.equal(second.reason,'TAB_BUSY');unblock();const completed=await first;assert.equal(completed.status,'verified');const continued=await agent.continue(second.runId);assert.equal(continued.status,'verified');assert.equal(continued.actions,0);
 });}finally{unblock?.();await agent.shutdown();await rm(home,{recursive:true,force:true});}
});

test('重启运行时后核对原档案现场，未知提交不会重放',async()=>{
 let submissions=0;const server=createServer((req,res)=>{if(req.method==='POST'){submissions++;res.writeHead(303,{location:'/result'});res.end();return;}res.setHeader('content-type','text/html; charset=utf-8');res.end(req.url==='/result'?`<output id="result">${submissions}</output>`:'<form method="post"><button>提交</button></form>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,home=await mkdtemp(join(tmpdir(),'jev-restart-')),id=randomUUID(),services={decide:async({page})=>({operation:'CLICK',target:page.actions.find(a=>a.label==='提交').id,operationConfidence:1,targetConfidence:1})};let agent;
 try{
  agent=await Agent.create({home,host:'restart',modelProxy:null,browserProxy:null,services});await agent.sessions.open({sessionId:id,url:origin,allowedOrigins:[origin],headless:true});const adapter=agent.sessions.get(id).adapter,execute=adapter.execute;
  adapter.execute=async(...args)=>{await execute(...args);await agent.sessions.get(id).page.waitForURL(origin+'/result');throw Error('确认中断');};const t={...task(origin,[{kind:'elementText',selector:'#result',equals:'1'}]),sessionId:id,requestId:randomUUID()};t.subgoals[0].allowSubmit=true;
  const first=await agent.start(t);assert.equal(first.reason,'uncertain_action',JSON.stringify(first));await agent.shutdown();
  agent=await Agent.create({home,host:'restart',modelProxy:null,browserProxy:null,services});await agent.sessions.open({sessionId:id,url:origin+'/result',allowedOrigins:[origin],headless:true});assert.equal((await agent.continue(first.runId)).reason,'session_reattach_required');const resumed=await agent.continue(first.runId,{reattach:true});assert.equal(resumed.status,'verified');assert.equal(resumed.actions,1);assert.equal(submissions,1);
  const context=agent.sessions.get(id).context;await context.close();await new Promise(r=>setTimeout(r,25));assert.equal((await agent.sessions.list())[0].status,'closed');assert.throws(()=>agent.sessions.get(id),e=>e.code==='SESSION_NOT_OPEN');
 }finally{await agent?.shutdown();await rm(home,{recursive:true,force:true});await new Promise(r=>server.close(r));}
});

test('独立浏览器重启后从同一详情续跑，恢复已观测目的地且不重放旧动作',async()=>{
 const visits=[];const server=createServer((req,res)=>{visits.push({url:req.url,method:req.method});res.setHeader('content-type','text/html');res.end(req.url==='/list'?'<h1>List</h1><a href="/detail">Detail</a>':'<h1>Detail</h1>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,home=await mkdtemp(join(tmpdir(),'jev-navigation-')),id=randomUUID(),c=new AbortController();let agent;
 const services={decide:async()=>{throw Error('唯一匹配已知地址无需模型');}};
 try{
  agent=await Agent.create({home,host:'navigation',modelProxy:null,browserProxy:null,services});const session=await agent.sessions.open({sessionId:id,url:origin+'/list',allowedOrigins:[origin],headless:true});
  const task={sessionId:id,requestId:randomUUID(),goal:'打开详情后返回列表',allowedOrigins:[origin],subgoals:[{id:'detail',goal:'打开详情',checks:[{kind:'url',equals:origin+'/detail'}]},{id:'return',goal:'返回列表',allowedKinds:['back'],checks:[{kind:'url',equals:origin+'/list'}]}],completionChecks:[{kind:'evidence',subgoal:'detail'},{kind:'evidence',subgoal:'return'}]};
  const stopped=await agent.start(task,{signal:c.signal,onProgress:({completed})=>{if(completed==='detail')c.abort();}});assert.equal(stopped.status,'cancelled');assert.equal(stopped.actions,1);
  await agent.shutdown();const before=visits.filter(v=>v.url==='/list').length;
  agent=await Agent.create({home,host:'navigation',modelProxy:null,browserProxy:null,services});await agent.sessions.open({sessionId:id,profileId:session.profileId,url:origin+'/detail',allowedOrigins:[origin],headless:true});
  assert.equal(visits.filter(v=>v.url==='/list').length,before);assert.equal((await agent.continue(stopped.runId)).reason,'session_reattach_required');
  const done=await agent.continue(stopped.runId,{reattach:true});assert.equal(done.status,'verified');assert.equal(done.actions,2);assert.equal(done.url,origin+'/list');assert.equal(visits.filter(v=>v.url==='/list').length,before+1);assert.ok(visits.every(v=>v.method==='GET'));
 }finally{await agent?.shutdown();await rm(home,{recursive:true,force:true});await new Promise(r=>server.close(r));}
});

test('网页诱导的跨来源表单提交在发送前拒绝，登录字段不进入候选',async()=>fixture('<form action="https://example.com/steal" method="post" onsubmit="event.preventDefault();document.querySelector(\'output\').textContent=\'已发送\'"><button>提交</button></form><form><label>账号<input name="username" value="私密账号"></label><input type="password" value="私密口令"></form><output>未发送</output>',async({adapter,origin,page})=>{
 const observed=await adapter.observe();assert.ok(!observed.actions.some(a=>a.kind==='fill'));assert.ok(observed.coverage.loginForms>0);assert.ok(!JSON.stringify(adapter.publicView(observed)).includes('私密账号'));const t=task(origin,[{kind:'elementText',selector:'output',equals:'已发送'}]);t.subgoals[0].allowSubmit=true;
 const r=await run(t,adapter,{decide:async({page})=>({operation:'CLICK',target:page.actions.find(a=>a.label==='提交').id,operationConfidence:1,targetConfidence:1})});assert.equal(r.reason,'needs_origin');assert.equal(r.actions,0);assert.equal(await page.locator('output').textContent(),'未发送');
}));

test('模型返回时目标已消失，局部校验立即返回并重新发现，不等待默认30秒',async()=>fixture('<button id="old" onclick="document.querySelector(\'output\').textContent=\'已完成\'">完成</button><output>未完成</output>',async({adapter,origin,page})=>{
 let calls=0;const began=performance.now(),services={decide:async({page:observed})=>{const chosen=observed.actions.find(a=>a.label==='完成');if(++calls===1)await page.locator('button').evaluate(e=>{const clone=e.cloneNode(true);clone.id='new';e.replaceWith(clone);});return{operation:'CLICK',target:chosen.id,operationConfidence:1,targetConfidence:1};}};
 const r=await run(task(origin,[{kind:'elementText',selector:'output',equals:'已完成'}]),adapter,services);assert.equal(r.status,'verified');assert.equal(r.actions,1);assert.equal(calls,2);assert.ok(performance.now()-began<2000);
}));

test('预填密钥文本和已完成敏感阶段的值不进入后续Jev状态',async()=>fixture('<label>联系号码<input value="13800138000"></label><textarea name="api_key">sk-fixture-private-key</textarea><button onclick="document.querySelector(\'output\').textContent=\'已完成\'">完成</button><output>未完成</output>',async({adapter,origin})=>{
 const t={goal:'敏感字段由宿主处理，然后完成普通按钮操作',allowedOrigins:[origin],inputs:{'联系号码':'13800138000'},subgoals:[{id:'private',goal:'由宿主核对联系号码',sensitive:true,checks:[{kind:'field',label:'联系号码',equals:'13800138000',sensitive:true}]},{id:'finish',goal:'点击完成',checks:[{kind:'elementText',selector:'output',equals:'已完成'}]}],completionChecks:[{kind:'evidence',subgoal:'private'},{kind:'evidence',subgoal:'finish'}]};
 const r=await run(t,adapter,{decide:async context=>{const raw=JSON.stringify(context);assert.ok(!raw.includes('13800138000'));assert.ok(!raw.includes('sk-fixture-private-key'));assert.ok(!context.page.actions.some(a=>a.label==='联系号码'));return{operation:'CLICK',target:context.page.actions.find(a=>a.label==='完成').id,operationConfidence:1,targetConfidence:1};}});assert.equal(r.status,'verified');
}));
