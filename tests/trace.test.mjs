import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrace } from '../src/trace.mjs';
import { browserAdapter } from '../src/browser-adapter.mjs';
import { run, resume } from '../src/core.mjs';

async function fixture(t,options={}){
  const dir=await mkdtemp(join(tmpdir(),'jev-trace-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const filePath=join(dir,'trace.jsonl'),trace=createTrace({filePath,heartbeatMs:10,...options});
  return{trace,rows:async()=> (await readFile(filePath,'utf8')).trim().split('\n').map(JSON.parse)};
}
test('调用未结束时，开始及等待事件已落盘，结束耗时与同一 span 对齐',async t=>{
  const f=await fixture(t);let release;const gate=new Promise(r=>release=r);
  const pending=f.trace.span('browser.dom.capture',{},()=>gate);
  await new Promise(r=>setTimeout(r,26));
  let rows=await f.rows();assert.equal(rows[0].event,'start');assert.ok(rows.some(r=>r.event==='waiting'&&r.elapsed_ms>=9));assert.ok(!rows.some(r=>r.event==='end'));
  release('ok');assert.equal(await pending,'ok');rows=await f.rows();
  assert.equal(rows.at(-1).event,'end');assert.equal(rows[0].span_id,rows.at(-1).span_id);assert.ok(rows.at(-1).elapsed_ms>=26);
  assert.deepEqual(rows.map(r=>r.seq),rows.map((_,i)=>i+1));assert.ok(rows.every(r=>Date.parse(r.timestamp)===r.epoch_ms));
});
test('并发子操作保留自己的父 span，错误原样抛出并记录安全原因',async t=>{
  const f=await fixture(t,{heartbeatMs:0}),error=Error('HTTP 503');
  await f.trace.withContext({run_id:'run-a'},()=>f.trace.span('root',{},()=>Promise.all([
    f.trace.span('left',{},async()=>{await new Promise(r=>setTimeout(r,8));return f.trace.span('left.child',{},()=>1);}),
    f.trace.span('right',{},()=>2)
  ])));
  await assert.rejects(f.trace.span('failure',{},()=>{throw error;}),e=>e===error);
  const rows=await f.rows(),start=name=>rows.find(r=>r.operation===name&&r.event==='start');
  assert.equal(start('left.child').parent_span_id,start('left').span_id);assert.equal(start('right').parent_span_id,start('root').span_id);
  assert.ok(rows.filter(r=>r.operation!=='failure').every(r=>r.run_id==='run-a'));assert.equal(rows.at(-1).data.message,'HTTP 503');
});
test('密钥、填入值、提示词和网址查询不进入日志或流式回调',async t=>{
  const shown=[],f=await fixture(t,{secrets:['private-entered-value','private-key'],onEvent:r=>shown.push(r),heartbeatMs:0});
  f.trace.event('start','privacy',{api_key:'private-key',prompt:'never log this',value:'private-entered-value',url:'https://example.test/form?password=hidden#secret',message:'Bearer abcsecret sk-123456789012 private-entered-value private-key'});
  const text=JSON.stringify([...await f.rows(),...shown]);
  for(const forbidden of ['private-key','private-entered-value','never log this','abcsecret','sk-123456789012','password=hidden','#secret'])assert.ok(!text.includes(forbidden),forbidden);
});
test('查看回调出错不改变执行结果；浏览器错误归属到定位步骤',async t=>{
  const f=await fixture(t,{heartbeatMs:0,onEvent:()=>{throw Error('viewer failure');}});
  const adapter=browserAdapter({id:'trace-tab',playwright:{evaluate:async()=>{throw Error('locator unavailable');}}},{trace:f.trace});
  await assert.rejects(adapter.execute({kind:'click',id:'e1',selector:'#target'}),/locator unavailable/);
  const rows=await f.rows();assert.equal(rows.at(-1).operation,'browser.target.validate');assert.equal(rows.at(-1).event,'error');assert.ok(!JSON.stringify(rows).includes('#target'));
  assert.equal(await f.trace.span('good',{},()=>42),42);
});
test('实际运行及续跑共享 run_id；检查点、动作和独立核验有完整关联',async t=>{
  const f=await fixture(t,{heartbeatMs:0});let satisfied=false;
  const adapter={trace:f.trace,identity:'trace-e2e',capabilities:async()=>({}),observe:async()=>({url:'https://example.test',revision:satisfied?'after':'before',actions:[{id:'e1',selector:'#field',kind:'fill',label:'名字'}]}),check:async()=>({ok:satisfied}),execute:async()=>{satisfied=true;}};
  const task={goal:'保存',allowedOrigins:['https://example.test'],subgoals:[{id:'save',goal:'填写名字',value:'不要记录这个值',checks:[{kind:'field'}]}],completionChecks:[{kind:'text'}]};
  const services={decide:async()=>({operation:'TYPE_TEXT',target:'e1',operationConfidence:1,targetConfidence:1})};
  const result=await run(task,adapter,services),continued=await resume(result.checkpoint,adapter,services);
  assert.equal(result.status,'verified');assert.equal(continued.status,'verified');assert.equal(result.traceFile,f.trace.filePath);
  const rows=await f.rows();assert.ok(rows.every(r=>r.run_id===result.runId));
  const action=rows.find(r=>r.operation==='runner.action.execute'&&r.event==='start');assert.equal(action.subgoal_id,'save');assert.equal(action.action_id,result.trace[0].id);
  assert.ok(rows.some(r=>r.operation==='runner.check.original_goal'&&r.event==='end'&&r.data.ok));assert.ok(rows.some(r=>r.operation==='runner.checkpoint.save'&&r.event==='end'));
  assert.ok(!JSON.stringify(rows).includes('不要记录这个值'));assert.equal(f.trace.writeErrors,0);
});
