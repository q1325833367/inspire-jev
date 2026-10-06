import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Agent} from '../src/agent.mjs';

async function fixture(work){
  const home=await mkdtemp(join(tmpdir(),'inspire-supervisor-'));
  const html='<label>名字<input id="name"></label><form method="post"><button type="submit">提交</button></form><output>0</output><script>let count=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("output").textContent=++count}</script>';
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const agent=await Agent.create({home,host:'test',browserProxy:null,modelProxy:null});
  try{const session=await agent.sessions.open({url:origin,allowedOrigins:[origin],headless:true});await work({agent,session,origin,page:agent.sessions.get(session.id).page,adapter:agent.sessions.get(session.id).adapter});}
  finally{await agent.close();await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true});}
}
const ref=async(adapter,label)=>(await adapter.observe()).actions.find(a=>a.label===label).ref;
test('接管填写核验实际值，记录不保存输入，运行身份可查',async()=>fixture(async({agent,session,adapter,page})=>{
  assert.match(session.buildFingerprint,/^[a-f0-9]{64}$/);assert.equal(session.host,'test');
  const result=await agent.act({sessionId:session.id,ref:await ref(adapter,'名字'),value:'明确给定文字'});
  assert.equal(result.effect,'effect_observed');assert.equal(result.requiresVerification,false);assert.equal(await page.locator('input').inputValue(),'明确给定文字');
  const record=await agent.store.read('supervisor',result.actionId);assert.ok(!JSON.stringify(record).includes('明确给定文字'));
  assert.equal((await agent.verifyAction({sessionId:session.id,actionId:result.actionId})).scope,'action');
}));
test('提交确认丢失后阻止重放，核验只读且幂等，未核验记录不清理',async()=>fixture(async({agent,session,adapter,page})=>{
  const execute=adapter.execute;adapter.execute=async(...args)=>{await execute(...args);throw Error('ack lost');};
  const first=await agent.act({sessionId:session.id,ref:await ref(adapter,'提交'),authorizedSubmit:true});
  assert.equal(first.reason,'uncertain_action');assert.equal(await page.locator('output').textContent(),'1');
  assert.equal((await agent.act({sessionId:session.id,ref:await ref(adapter,'提交'),authorizedSubmit:true})).actionId,first.actionId);
  assert.equal(await page.locator('output').textContent(),'1');
  assert.equal((await agent.store.cleanup({dryRun:false,now:Date.now()+8*86400000})).deleted.length,0);
  await assert.rejects(agent.verifyAction({sessionId:session.id,actionId:first.actionId,checks:[{kind:'url'}]}),/后置条件/);
  await assert.rejects(agent.verifyAction({sessionId:'other',actionId:first.actionId,checks:[{kind:'text',includes:'1'}]}));
  const check={sessionId:session.id,actionId:first.actionId,checks:[{kind:'elementText',selector:'output',equals:'1'}]};
  assert.equal((await agent.verifyAction(check)).status,'verified');assert.equal((await agent.verifyAction(check)).status,'verified');
  assert.equal(await page.locator('output').textContent(),'1');
  const cleaned=await agent.store.cleanup({dryRun:false,now:Date.now()+8*86400000});assert.ok(cleaned.deleted.includes('supervisor/'+first.actionId+'.json'));
}));
test('执行层明确未发出时保留未执行状态，准备后取消不填写',async()=>fixture(async({agent,session,adapter,page})=>{
  adapter.execute=async()=>{throw Object.assign(Error('cancelled'),{notIssued:true});};
  const result=await agent.act({sessionId:session.id,ref:await ref(adapter,'名字'),value:'不应填写'});
  assert.equal(result.effect,'not_executed');assert.equal((await agent.verifyAction({sessionId:session.id,actionId:result.actionId})).status,'not_executed');
  assert.equal(await page.locator('input').inputValue(),'');
  const controller=new AbortController();const validate=adapter.validate;adapter.validate=async a=>{const r=await validate(a);controller.abort();return r;};
  const stopped=await agent.act({sessionId:session.id,ref:await ref(adapter,'名字'),value:'不应填写'},{signal:controller.signal});
  assert.equal(stopped.status,'cancelled');assert.equal(stopped.effect,'not_executed');assert.equal(await page.locator('input').inputValue(),'');
}));
test('单步新文字只生成一次，缺值不写入，生成期间用户改值时不覆盖',async()=>fixture(async({agent,session,adapter,page})=>{
  let calls=0;agent.injectedServices={generate:async()=>{calls++;return{text:'新生成文字',model:'text-test',usage:{output_tokens:3},latency_ms:1};}};
  assert.equal((await agent.act({sessionId:session.id,ref:await ref(adapter,'名字')})).reason,'missing_input_value');assert.equal(await page.locator('input').inputValue(),'');assert.equal(calls,0);
  const generated=await agent.act({sessionId:session.id,ref:await ref(adapter,'名字'),generate:'生成新文字'});assert.equal(generated.textGeneration.model,'text-test');assert.equal(generated.effect,'effect_observed');assert.equal(calls,1);
  agent.injectedServices.generate=async()=>{await page.locator('input').fill('用户改变的值');return{text:'不应覆盖',model:'text-test'};};
  assert.equal((await agent.act({sessionId:session.id,ref:await ref(adapter,'名字'),generate:'生成另一段文字'})).reason,'target_changed');assert.equal(await page.locator('input').inputValue(),'用户改变的值');
}));
