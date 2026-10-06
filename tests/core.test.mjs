import test from 'node:test';
import assert from 'node:assert/strict';
import {run,resume,resolveChecks} from '../src/core.mjs';
import {taskSchema,toolDefinitions,toolJSONSchema} from '../src/tools.mjs';
const task={goal:'填写并保存',allowedOrigins:['https://example.test'],subgoals:[{id:'fill',goal:'填写名字',value:'测试',checks:[{kind:'field'}]}],completionChecks:[{kind:'text'}]};
function environment(identity='test:1'){
  let satisfied=false, revision='initial', writes=0;
  const adapter={identity,capabilities:async()=>({}),observe:async()=>({url:'https://example.test',revision,coverage:{},actions:[{id:'field',kind:'fill',label:'名字'}]}),check:async()=>({ok:satisfied}),execute:async()=>{writes++;satisfied=true;revision='changed';}};
  return{adapter,get writes(){return writes;},set(value){satisfied=value;revision='supervisor';}};
}
const services={decide:async()=>({operation:'TYPE_TEXT',target:'field',operationConfidence:1,targetConfidence:1,usage:{input_tokens:5}})};
test('已知文字无需生成；完整条件经过独立检查',async()=>{const e=environment();const r=await run(task,e.adapter,{...services,generate:()=>{throw Error('不应调用');}});assert.equal(r.status,'verified');assert.equal(e.writes,1);assert.equal(r.metrics.text_calls,0);assert.ok(!JSON.stringify(r).includes('"text":"测试"'));});
test('显式配置置信度门槛时不写入，接管后从原现场续跑',async()=>{const e=environment();const r=await run({...task,thresholds:{operation:.7,target:.85}},e.adapter,{decide:async()=>({operation:'TYPE_TEXT',target:'field',operationConfidence:.6,targetConfidence:1})});assert.equal(r.reason,'low_operation_confidence');assert.equal(e.writes,0);e.set(true);const resumed=await resume(r.checkpoint,e.adapter,services);assert.equal(resumed.status,'verified');assert.equal(resumed.handoffs,1);assert.equal(e.writes,0);});
test('模型 DONE 不能越过失败的独立检查',async()=>{const e=environment();const r=await run(task,e.adapter,{decide:async()=>({operation:'DONE',operationConfidence:1})});assert.equal(r.reason,'done_not_verified');assert.equal(e.writes,0);});
test('冲突数据引用在观察与模型调用前拒绝，包括最终条件',async()=>{
 const e=environment('invalid-reference');let reads=0,decisions=0;e.adapter.observe=async()=>{reads++;throw Error('不得观测');};
 const service={decide:async()=>{decisions++;return services.decide();}};
 for(const ref of [{subgoal:'fill',field:'links',source:'url'},{subgoal:'fill',source:'url',index:0},{subgoal:'fill'},{subgoal:'fill',field:''}]){
  for(const final of [true,false]){
   const t={...task,subgoals:[task.subgoals[0],{id:'detail',goal:'核查详情',checks:[{kind:'url',equalsFrom:final?{subgoal:'fill',source:'url'}:ref}]}],completionChecks:final?[{kind:'url',equalsFrom:ref}]:task.completionChecks};
   await assert.rejects(run(t,e.adapter,service),error=>error.code==='INVALID_TASK_REFERENCE');
   assert.equal(taskSchema.safeParse({...t,sessionId:'test',requestId:'test'}).success,false);
   assert.throws(()=>resolveChecks([{kind:'url',equalsFrom:ref}],{}),error=>error.code==='INVALID_TASK_REFERENCE');
  }
 }
 assert.equal(reads,0);assert.equal(decisions,0);assert.equal(e.writes,0);
});
test('有效字段及页面地址引用保持兼容并导出互斥工具协议',()=>{
 const refs=[{subgoal:'fill',field:'links',index:0,resolveUrl:true},{subgoal:'fill',source:'url'}];
 const checks=refs.map(ref=>({kind:'url',equalsFrom:ref}));
 assert.deepEqual(resolveChecks(checks,{fill:{url:'https://example.test/list/',data:{links:['../book']}}}).map(c=>c.equals),['https://example.test/book','https://example.test/list/']);
 assert.equal(taskSchema.safeParse({...task,sessionId:'test',requestId:'test',completionChecks:checks}).success,true);
 const schema=toolJSONSchema(toolDefinitions.find(d=>d.name==='jev_run'));
 const variants=schema.properties.task.properties.completionChecks.items.properties.equalsFrom.anyOf;
 assert.equal(variants.length,2);assert.ok(variants.every(v=>v.additionalProperties===false));
});
test('只有歧义检查未满足时直接接管，不调用模型或写入',async()=>{
 const e=environment('ambiguous-check');e.adapter.check=async()=>({ok:false,details:[{kind:'url',ok:true},{kind:'attribute',ok:false,count:2}]});
 const r=await run(task,e.adapter,{decide:()=>{throw Error('检查器歧义不应交给模型');}});
 assert.equal(r.reason,'ambiguous_check');assert.equal(r.detail.evidence.details[1].count,2);assert.equal(r.metrics.decision_calls,0);assert.equal(e.writes,0);
});
test('页面身份未满足或目标缺失时不提前宣布检查器歧义',async()=>{
 for(const details of [[{kind:'url',ok:false},{kind:'attribute',ok:false,count:2}],[{kind:'attribute',ok:false,count:0}]]){
  const e=environment(`discover-${details.length}`);e.adapter.check=async()=>({ok:false,details});
  const r=await run(task,e.adapter,{decide:async()=>({operation:'BLOCKED',operationConfidence:1})});assert.equal(r.reason,'blocked');assert.equal(r.metrics.decision_calls,1);
 }
});
test('循环阶段证据与未来数据引用在观察和写入前拒绝',async()=>{const e=environment('invalid-plan');e.adapter.observe=async()=>{throw Error('无效规划不应进入浏览器');};for(const checks of [[{kind:'evidence',subgoal:'fill'}],[{kind:'url',equalsFrom:{subgoal:'fill',source:'url'}}],[{kind:'url',equalsFrom:{subgoal:'future',source:'url'}}]]){await assert.rejects(run({...task,subgoals:[{id:'fill',goal:'错误规划',checks}]},e.adapter,services),/阶段/);assert.equal(e.writes,0);}});
test('正文提取与链接列表混用在观察前拒绝',async()=>{const e=environment('invalid-extract');e.adapter.observe=async()=>{throw Error('无效采集不应进入浏览器');};for(const extra of [{attribute:'href'},{all:true},{maxItems:3}]){await assert.rejects(run({...task,subgoals:[{...task.subgoals[0],extract:[{name:'links',source:'section',selector:'h2',...extra}]}]},e.adapter,services),/source=section/);assert.equal(e.writes,0);}});
test('模型收到独立检查发现的未完成结果，不依赖结果在视口中',async()=>{const e=environment('missing-preview');e.adapter.check=async()=>({ok:e.writes>0,details:[{kind:'field',label:'名字',ok:true,actual:'测试'},{kind:'text',expected:'预览已生成',ok:e.writes>0}]});const r=await run({...task,subgoals:[{id:'business',goal:'填写名字并生成预览',value:'测试',checks:[{kind:'field',label:'名字',equals:'测试'},{kind:'text',includes:'预览已生成'}]}]},e.adapter,{decide:async({step})=>{assert.deepEqual(step.pendingRequirements,[{kind:'text',label:undefined,expected:'预览已生成'}]);assert.ok(!JSON.stringify(step).includes('"actual"'));return services.decide();}});assert.equal(r.status,'verified');assert.equal(e.writes,1);});
test('不同句柄同一物理标签页仍互斥',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),acquired=new Promise(r=>entered=r);
 const e=environment(`same-tab:${crypto.randomUUID()}`);
 const first=run(task,e.adapter,{decide:async()=>{entered();await gate;return services.decide();}});
 await Promise.race([acquired,first]);
 try{await assert.rejects(run(task,{...e.adapter},services),/写入任务/);}finally{release();}
 assert.equal((await first).status,'verified');
});
test('写入中断未知效果，不重复提交',async()=>{const e=environment();e.adapter.execute=async()=>{throw Error('ack lost');};const first=await run(task,e.adapter,services);assert.equal(first.reason,'uncertain_action');const again=await resume(first.checkpoint,e.adapter,services);assert.equal(again.reason,'uncertain_action');assert.equal(again.actions,1);e.set(true);assert.equal((await resume(again.checkpoint,e.adapter,services)).status,'verified');});
test('取消后不发起写入',async()=>{const e=environment(),c=new AbortController();const r=await run(task,e.adapter,{decide:async()=>{c.abort();return services.decide();}},{signal:c.signal});assert.equal(r.status,'cancelled');assert.equal(e.writes,0);});
test('检查点累计动作预算，不因 resume 重置',async()=>{const e=environment();e.adapter.check=async()=>({ok:false});e.adapter.execute=async()=>{};const r=await run({...task,budget:{maxActions:1}},e.adapter,services);assert.equal(r.status,'budget_reached');const r2=await resume(r.checkpoint,e.adapter,services);assert.equal(r2.status,'budget_reached');assert.equal(r2.actions,1);});
test('原始完成条件覆盖被遗漏的要求',async()=>{const e=environment();e.adapter.check=async checks=>({ok:checks[0].kind==='field'});const r=await run(task,e.adapter,services);assert.equal(r.reason,'original_goal_not_verified');});
test('覆盖不足与真正 BLOCKED 分开报告',async()=>{const e=environment();e.adapter.observe=async()=>({url:'https://example.test',revision:'a',actions:[],coverage:{offscreen:5}});const r=await run(task,e.adapter,{decide:async()=>({operation:'BLOCKED',operationConfidence:1})});assert.equal(r.reason,'observation_incomplete');});
test('未授权目标来源在输入前拦截',async()=>{const e=environment();e.adapter.observe=async()=>({url:'https://example.test',revision:'a',actions:[{id:'field',kind:'click',label:'页面诱导',href:'https://other.test'}]});const r=await run(task,e.adapter,services);assert.equal(r.reason,'needs_origin');assert.equal(e.writes,0);});
test('宿主接管完成后可从同一现场续跑',async()=>{const e=environment('host-only');const r=await run({...task,subgoals:task.subgoals.map(s=>({...s,hostOnly:true}))},e.adapter,services);assert.equal(r.reason,'host_action_required');e.set(true);const continued=await resume(r.checkpoint,e.adapter,services);assert.equal(continued.status,'verified');assert.equal(e.writes,0);});
test('无效置信度配置不能禁用校验',async()=>{const e=environment();await assert.rejects(run({...task,thresholds:{operation:-1}},e.adapter,services),/置信度门槛/);assert.equal(e.writes,0);});
test('模型返回期间页面已完成，不因过时的低置信度再次接管',async()=>{const e=environment('async-result');const r=await run(task,e.adapter,{decide:async()=>{e.set(true);return{operation:'WAIT',operationConfidence:.5};}});assert.equal(r.status,'verified');assert.equal(e.writes,0);assert.equal(r.metrics.decision_calls,1);});
test('无关页面文字变化不使同一目标失效',async()=>{const e=environment('target-guard');let reads=0;const observe=e.adapter.observe;e.adapter.observe=async()=>({...await observe(),text:`动态提示 ${++reads}`,revision:String(reads)});const r=await run(task,e.adapter,services);assert.equal(r.status,'verified');assert.equal(e.writes,1);assert.equal(r.metrics.decision_calls,1);});
test('唯一文字字段直接生成；页面变化不重复生成或调用额外决策',async()=>{const e=environment('new-text');let observes=0,calls=0;const original=e.adapter.observe;e.adapter.observe=async()=>({...await original(),text:'测试表单',revision:++observes<=2?'before':'changed'});const generated={...task,subgoals:[{id:'text',goal:'填写礼貌问候',generate:'生成一句问候',checks:[{kind:'field',label:'名字',notEmpty:true}]}]};const r=await run(generated,e.adapter,{decide:()=>{throw Error('唯一目标不应调用 Jev');},generate:async()=>{calls++;return{text:'独立生成内容',usage:{prompt_tokens:2}};}});assert.equal(r.status,'verified');assert.equal(calls,1);assert.equal(e.writes,1);assert.equal(r.metrics.decision_calls,0);assert.equal(r.metrics.text_calls,1);assert.ok(!JSON.stringify(r).includes('独立生成内容'));});
