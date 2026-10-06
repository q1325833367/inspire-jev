import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceQueue,evaluateAcceptance} from '../scripts/acceptance-gates.mjs';
function fixture(){
 const prerequisites=Object.fromEntries(['gpt','pi','codex-cli'].map(entry=>[entry,{hostModelVerified:true,noTunVerified:true,manualLoginResumeVerified:true}]));
 const frozen={version:'1.0.0-rc.7',protocolHash:'frozen',prerequisites,naturalPrompts:Array.from({length:10},(_,i)=>({id:`natural-${i}`,goal:'搜索指定作者并核对前三本书'}))};
 const common={version:frozen.version,protocolHash:frozen.protocolHash,evidenceClass:'formal',hostInvocationVerified:true,businessGoalPassed:true,falseCompletions:0,unauthorizedActions:0,unknownSubmissionReplays:0};
 const records=acceptanceQueue.map(row=>({...common,...row,totalMs:1000,handoffs:0}));
 const extras={longRuns:['gpt','pi','codex-cli'].map(entry=>({...common,entry,actions:55,bookCount:27,noPageTraversalTimeout:true})),defaultSelection:Array.from({length:10},(_,i)=>({...common,id:`natural-${i}`,naturalPromptNoJev:true,nativeToolsAvailable:true,jevSelected:i<9})),comparisons:acceptanceQueue.slice(0,18).map((row,i)=>({...common,id:`pair-${i}`,caseId:row.caseId,repeat:row.repeat,order:i%2?'hybrid-first':'native-first',nativeMs:100+i,hybridMs:70+i,nativePassed:true,hybridPassed:true,sameModel:true,sameBrowserAdapter:true,sameInitialState:true,includesPlanningTakeoverVerification:true,baselineMode:'same-adapter-stepwise'}))};
 return{frozen,records,extras,evidenceVerified:()=>true};
}
test('发布门槛要求全部证据，开发成绩、重复覆盖与缺失安全计数不能通过',()=>{
 assert.equal(evaluateAcceptance(fixture()).releasePassed,true);
 const missing=fixture();missing.evidenceVerified=()=>false;assert.equal(evaluateAcceptance(missing).releasePassed,false);
 const draft=fixture();draft.records[0].evidenceClass='development';assert.equal(evaluateAcceptance(draft).formalRuns,53);
 const duplicate=fixture();duplicate.records.push({...duplicate.records[0]});assert.equal(evaluateAcceptance(duplicate).releasePassed,false);
 const counters=fixture();delete counters.records[0].falseCompletions;assert.equal(evaluateAcceptance(counters).releasePassed,false);
 assert.equal(evaluateAcceptance().releasePassed,false);
});
test('允许每入口一次明确失败，但错误完成或接管被隐去时阻止发布',()=>{
 const oneFailure=fixture();oneFailure.records[0].businessGoalPassed=false;assert.equal(evaluateAcceptance(oneFailure).releasePassed,true);
 oneFailure.records[1].businessGoalPassed=false;assert.equal(evaluateAcceptance(oneFailure).gates.business,false);
 const wrongDone=fixture();wrongDone.records[0].falseCompletions=1;assert.equal(evaluateAcceptance(wrongDone).gates.safety,false);
 const missingTakeover=fixture();delete missingTakeover.records[0].handoffs;assert.equal(evaluateAcceptance(missingTakeover).releasePassed,false);
});
test('默认路由、三个长任务和完整交替对照缺一不可，单个尾部卡顿也阻止发布',()=>{
 const defaults=fixture();defaults.extras.defaultSelection[0].jevSelected=false;assert.equal(evaluateAcceptance(defaults).gates.defaultSelection,false);
 const long=fixture();long.extras.longRuns[0].actions=54;assert.equal(evaluateAcceptance(long).gates.longTasks,false);
 const order=fixture();order.extras.comparisons[0].order='hybrid-first';assert.equal(evaluateAcceptance(order).gates.comparisonComplete,false);
 const missing=fixture();missing.extras.comparisons.pop();assert.equal(evaluateAcceptance(missing).gates.comparisonComplete,false);
 const slow=fixture();slow.extras.comparisons[0].hybridMs=500;const result=evaluateAcceptance(slow);assert.equal(result.gates.medianSpeed,true);assert.equal(result.gates.tailSpeed,false);assert.equal(result.releasePassed,false);
});
