import test from 'node:test';
import assert from 'node:assert/strict';
import {browserAdapter} from '../src/browser-adapter.mjs';
import {run} from '../src/core.mjs';

test('后退只提供已观测的目的地，经独立核验返回原页，不使用 DOM 定位器',async()=>{
  let url='https://example.test/list',backs=0;
  const tab={id:'back-test',url:async()=>url,back:async()=>{backs++;url='https://example.test/list';},playwright:{evaluate:async(fn,arg)=>fn.name==='checkPage'?{ok:url==='https://example.test/list',details:[{kind:'url',ok:url==='https://example.test/list'}],url}:{url,title:url,actions:[],coverage:{totalCandidates:0}},locator:()=>{throw Error('后退不能通过网页控件模拟');}}};
  const adapter=browserAdapter(tab,{driver:'test'});
  assert.equal((await adapter.observe()).actions.length,0);
  url='https://example.test/detail';
  const actions=(await adapter.observe()).actions;
  assert.equal(actions[0].href,'https://example.test/list');
  const checks=[{kind:'url',equals:'https://example.test/list'}];
  const result=await run({goal:'返回列表',allowedOrigins:['https://example.test'],subgoals:[{id:'return',goal:'返回列表',checks}],completionChecks:checks},adapter,{decide:async()=>({operation:'BACK',target:'host_back',operationConfidence:1,targetConfidence:1})});
  assert.equal(result.status,'verified');assert.equal(backs,1);assert.equal(result.actions,1);
  assert.equal((await adapter.observe()).actions.length,0);
});

test('后退不能绕过目标来源校验',async()=>{
  let url='https://other.test/list',backs=0;
  const adapter=browserAdapter({id:'back-origin',url:async()=>url,back:async()=>{backs++;},playwright:{evaluate:async(fn,arg)=>fn.name==='checkPage'?{ok:false,details:[],url}:{url,actions:[],coverage:{totalCandidates:0}}}},{driver:'test'});
  await adapter.observe();url='https://example.test/detail';await adapter.observe();
  const checks=[{kind:'url',equals:'https://other.test/list'}];
  const result=await run({goal:'返回列表',allowedOrigins:['https://example.test'],subgoals:[{id:'return',goal:'返回列表',checks}],completionChecks:checks},adapter,{decide:async()=>({operation:'BACK',target:'host_back',operationConfidence:1,targetConfidence:1})});
  assert.equal(result.reason,'needs_origin');assert.equal(backs,0);
});

test('现场被用户改变后旧后退目标失效',async()=>{
 let url='https://example.test/list';const adapter=browserAdapter({id:'changed-back',url:async()=>url,back:async()=>{},playwright:{evaluate:async()=>({url,actions:[],coverage:{}})}},{driver:'test'});
 await adapter.observe();url='https://example.test/detail';const observed=await adapter.observe(),back=observed.actions.find(a=>a.kind==='back');assert.equal((await adapter.validate(back)).ok,true);
 url='https://example.test/user';assert.equal((await adapter.validate(back)).ok,false);
});
