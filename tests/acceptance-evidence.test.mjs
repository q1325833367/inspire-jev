import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {ledger,readLedger,exclusiveJSON,hash} from '../scripts/acceptance-evidence.mjs';
import {normalizeNative} from '../scripts/acceptance-native.mjs';
import {checkBusiness} from '../scripts/acceptance-checkers.mjs';
import {Agent} from '../src/agent.mjs';

test('证据追加保留顺序与哈希，修改、截断和覆盖冻结文件均拒绝',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'inspire-evidence-')),path=join(dir,'events.jsonl');try{
  const emit=await ledger(path);await Promise.all([emit({type:'start'}),emit({type:'end'})]);assert.equal((await readLedger(path)).length,2);
  const text=await readFile(path,'utf8');await writeFile(path,text.replace('start','changed'));await assert.rejects(readLedger(path),/修改/);
  await writeFile(path,text.slice(0,-1));await assert.rejects(readLedger(path),/完整写入/);
  await exclusiveJSON(join(dir,'freeze.json'),{protocolHash:'fixed'});await assert.rejects(exclusiveJSON(join(dir,'freeze.json'),{}),{code:'EEXIST'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('原生事件归一化保留实际参数与结果摘要，丢弃输入实值和消息正文',()=>{
 const state={calls:new Map()},value='SENSITIVE_TEST_TEXT_43',args={value},result={status:'executed',page:{value}};
 normalizeNative('pi',{type:'tool_execution_start',toolCallId:'id',toolName:'jev_session',args},state);
 const events=normalizeNative('pi',{type:'tool_execution_end',toolCallId:'id',toolName:'jev_session',result:{details:{result}}},state);
 assert.equal(events[0].argsHash,hash(args));assert.equal(events[0].resultHash,hash(result));assert.ok(!JSON.stringify(events).includes(value));
 assert.equal(normalizeNative('pi',{type:'message_end',message:{role:'user',content:[{type:'text',text:value}]}},state).length,0);
});
test('只看见正确网页但没有主模型收到的字段，独立检查不能通过',()=>{
 const url='https://en.wikipedia.org/wiki/Alan_Turing',snapshot={url,heading:'Alan Turing',fields:['Born actual birth','Education actual education','Known for actual contribution']};
 const events=[{type:'snapshot',snapshot},{type:'action',phase:'issued',kind:'fill',valueHash:hash('Alan Turing')}];
 assert.equal(checkBusiness('wiki-fields',events).passed,false);
 events.push({type:'tool_end',collection:{read:{url,data:{title:'Alan Turing'}}}});assert.equal(checkBusiness('wiki-fields',events).passed,false);
 events.at(-1).collection.read.data.fields=snapshot.fields;assert.equal(checkBusiness('wiki-fields',events).passed,true);
});
test('真实 Chromium 观察器记录执行边界和耗时，输入不入日志，取消后不新建会话',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'inspire-observer-')),context=join(dir,'context.json'),oldObserver=process.env.INSPIRE_JEV_TEST_OBSERVER,oldContext=process.env.INSPIRE_JEV_ACCEPTANCE_CONTEXT;
 const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end('<label>Name<input id="name"></label>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let agent;
 try{
  await exclusiveJSON(context,{entry:'test',id:'observer-test',directory:dir,caseId:'test',packageSHA256:'a'.repeat(64)});process.env.INSPIRE_JEV_TEST_OBSERVER=new URL('../scripts/acceptance-observer.mjs',import.meta.url).pathname;process.env.INSPIRE_JEV_ACCEPTANCE_CONTEXT=context;
  agent=await Agent.create({home:join(dir,'home'),host:'test',browserProxy:null,modelProxy:null});const session=await agent.call('jev_session',{action:'open',url:origin,allowedOrigins:[origin],headless:true});const view=await agent.call('jev_session',{action:'inspect',sessionId:session.id}),ref=view.page.actions.find(a=>a.kind==='fill').ref;
  await agent.call('jev_session',{action:'act',sessionId:session.id,ref,value:'SENSITIVE_TEST_TEXT_43'});const events=await readLedger(join(dir,'observer.jsonl'));
  assert.ok(events.some(e=>e.type==='action'&&e.phase==='issued'));assert.ok(events.some(e=>e.type==='action'&&e.phase==='acknowledged'));assert.ok(events.some(e=>e.type==='tool_end'&&e.durationMs>0));assert.ok(!(await readFile(join(dir,'observer.jsonl'),'utf8')).includes('SENSITIVE_TEST_TEXT_43'));
  await writeFile(join(dir,'cancel.request'),'cancel');await new Promise(r=>setTimeout(r,1100));assert.equal((await agent.call('jev_session',{action:'open',url:origin,allowedOrigins:[origin],headless:true})).status,'cancelled');
 }finally{if(oldObserver===undefined)delete process.env.INSPIRE_JEV_TEST_OBSERVER;else process.env.INSPIRE_JEV_TEST_OBSERVER=oldObserver;if(oldContext===undefined)delete process.env.INSPIRE_JEV_ACCEPTANCE_CONTEXT;else process.env.INSPIRE_JEV_ACCEPTANCE_CONTEXT=oldContext;await agent?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
