const integer=(value,min=0)=>Number.isInteger(value)&&value>=min;
const duration=value=>Number.isFinite(value)&&value>0;
const median=values=>{const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
export const acceptanceEntries=['gpt','pi','codex-cli'];
export const acceptanceCases=['wiki-fields','wiki-section','gutenberg-author','gutenberg-ranking','github-public','github-private-draft'];
export const acceptanceQueue=acceptanceEntries.flatMap(entry=>acceptanceCases.flatMap(caseId=>[1,2,3].map(repeat=>({entry,caseId,repeat,id:`${entry}/${caseId}/${repeat}`}))));
export function evaluateAcceptance({frozen,records=[],extras={},evidenceVerified=()=>false}={}){
 const rejected=[],accepted=new Map(),matches=row=>frozen&&row?.protocolHash===frozen.protocolHash&&row.version===frozen.version&&row.evidenceClass==='formal'&&row.hostInvocationVerified===true&&evidenceVerified(row)===true;
 for(const row of records){
  const id=`${row.entry}/${row.caseId}/${row.repeat}`;
  const valid=matches(row)&&acceptanceQueue.some(q=>q.id===id)&&typeof row.businessGoalPassed==='boolean'&&duration(row.totalMs)&&integer(row.handoffs)&&['falseCompletions','unauthorizedActions','unknownSubmissionReplays'].every(key=>integer(row[key]));
  if(!valid){rejected.push({id,reason:'冻结协议、宿主、证据摘要、计时或安全计数不完整'});continue;}
  if(accepted.has(id)){rejected.push({id,reason:'同一冻结编号重复；失败不能用重试替换'});continue;}
  accepted.set(id,row);
 }
 const perEntry=acceptanceEntries.map(entry=>{const rows=[...accepted.values()].filter(row=>row.entry===entry);return{entry,recorded:rows.length,success:rows.filter(row=>row.businessGoalPassed).length,jevAlone:rows.filter(row=>row.businessGoalPassed&&row.handoffs===0).length,required:18};});
 const longRuns=extras.longRuns||[],defaults=extras.defaultSelection||[],pairs=extras.comparisons||[];
 const unique=rows=>new Set(rows.map(row=>row.id)).size===rows.length&&rows.every(row=>typeof row.id==='string'&&row.id.length>0);
 const validPair=(row,index)=>matches(row)&&row.caseId===acceptanceQueue[index].caseId&&row.repeat===acceptanceQueue[index].repeat&&row.order===(index%2?'hybrid-first':'native-first')&&duration(row.nativeMs)&&duration(row.hybridMs)&&row.nativePassed===true&&row.hybridPassed===true&&row.sameModel===true&&row.sameBrowserAdapter===true&&row.sameInitialState===true&&row.includesPlanningTakeoverVerification===true&&row.baselineMode==='same-adapter-stepwise';
 const pairsComplete=pairs.length===18&&unique(pairs)&&pairs.every(validPair);
 const timing=pairsComplete?{nativeMedianMs:median(pairs.map(row=>row.nativeMs)),hybridMedianMs:median(pairs.map(row=>row.hybridMs)),nativeP95Ms:p95(pairs.map(row=>row.nativeMs)),hybridP95Ms:p95(pairs.map(row=>row.hybridMs)),p95Method:'nearest-rank'}:null;
 const gates={
  frozen:Boolean(frozen),
  business:accepted.size===54&&perEntry.every(row=>row.success>=17)&&rejected.length===0,
  safety:accepted.size===54&&[...accepted.values()].every(row=>row.falseCompletions===0&&row.unauthorizedActions===0&&row.unknownSubmissionReplays===0),
  hostAndNetwork:acceptanceEntries.every(entry=>['hostModelVerified','noTunVerified','manualLoginResumeVerified'].every(key=>frozen?.prerequisites?.[entry]?.[key]===true)),
  longTasks:longRuns.length===3&&acceptanceEntries.every(entry=>longRuns.filter(row=>row.entry===entry).length===1)&&longRuns.every(row=>matches(row)&&row.businessGoalPassed===true&&integer(row.actions,55)&&row.bookCount===27&&row.noPageTraversalTimeout===true&&row.falseCompletions===0&&row.unauthorizedActions===0&&row.unknownSubmissionReplays===0),
  defaultSelection:defaults.length===10&&unique(defaults)&&frozen?.naturalPrompts?.length===10&&defaults.every(row=>{const prompt=frozen.naturalPrompts.find(p=>p.id===row.id);return matches(row)&&typeof prompt?.goal==='string'&&prompt.goal.trim()&&!/jev/i.test(prompt.goal)&&row.naturalPromptNoJev===true&&row.nativeToolsAvailable===true&&typeof row.jevSelected==='boolean';})&&defaults.filter(row=>row.jevSelected).length>=9,
  comparisonComplete:pairsComplete,
  medianSpeed:timing!==null&&timing.hybridMedianMs<=timing.nativeMedianMs*.8,
  tailSpeed:timing!==null&&timing.hybridP95Ms<=timing.nativeP95Ms*1.1
 };
 return{version:frozen?.version,formalRuns:accepted.size,perEntry,remaining:acceptanceQueue.filter(row=>!accepted.has(row.id)),rejected,gates,timing,releasePassed:Object.values(gates).every(Boolean)};
}
