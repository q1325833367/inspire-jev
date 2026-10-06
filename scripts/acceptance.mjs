import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {VERSION} from '../src/config.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const entries=['gpt','pi','codex-cli'],cases=['wiki-fields','wiki-section','gutenberg-author','gutenberg-ranking','github-public','github-private-draft'];
const directory='artifacts/acceptance',command=process.argv[2]||'report';await mkdir(directory,{recursive:true});
const read=async name=>{try{return JSON.parse(await readFile(join(directory,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const queue=entries.flatMap(entry=>cases.flatMap(caseId=>[1,2,3].map(repeat=>({entry,caseId,repeat,id:`${entry}/${caseId}/${repeat}`}))));
try{
 if(command==='prepare'){
  const proposal={version:VERSION,status:'draft',notFormalEvidence:true,queue,requirements:'docs/ACCEPTANCE.md',frozen:false};await writeFile(join(directory,'queue.json'),JSON.stringify(proposal,null,2));console.log(JSON.stringify({status:'draft',runs:queue.length,path:join(directory,'queue.json'),note:'先通过 M2，再冻结正式协议。'},null,2));
 }else if(command==='freeze'){
  const pre=await read('prerequisites.json'),missing=entries.flatMap(entry=>['hostModelVerified','noTunVerified','manualLoginResumeVerified'].filter(key=>pre?.[entry]?.[key]!==true).map(key=>`${entry}.${key}`));
  if(missing.length)throw Error('M2 证据未齐，不能冻结正式验收：'+missing.join('、'));
  if(await read('freeze.json'))throw Error('已有冻结记录；修改须建立新验收目录，保留原失败');
  const paths=['package-lock.json','package.json','scripts/public-cases.mjs','scripts/long-gutenberg.mjs','docs/ACCEPTANCE.md','src/tools.mjs','src/core.mjs','src/snapshot.mjs','src/browser-adapter.mjs','src/providers.mjs'];
  const files=Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
  const frozen={version:VERSION,at:new Date().toISOString(),queue,files,prerequisites:pre};frozen.protocolHash=sha(JSON.stringify(frozen));await writeFile(join(directory,'freeze.json'),JSON.stringify(frozen,null,2),{flag:'wx'});console.log(JSON.stringify({status:'frozen',protocolHash:frozen.protocolHash,runs:queue.length}));
 }else if(command==='report'){
  const frozen=await read('freeze.json'),records=await read('runs.json')||[],rejected=[],accepted=new Map();
  for(const record of records){const id=`${record.entry}/${record.caseId}/${record.repeat}`,valid=frozen&&queue.some(q=>q.id===id)&&record.protocolHash===frozen.protocolHash&&record.version===VERSION&&record.evidenceClass==='formal'&&record.hostInvocationVerified===true&&typeof record.businessGoalPassed==='boolean'&&Number.isFinite(record.totalMs)&&record.totalMs>0&&typeof record.evidencePath==='string';if(!valid){rejected.push({id,reason:'缺少冻结协议、真实宿主调用或独立业务核验'});continue;}if(accepted.has(id)){rejected.push({id,reason:'同一冻结运行编号重复；失败不得用重试替换'});continue;}await readFile(record.evidencePath);accepted.set(id,record);}
  const perEntry=entries.map(entry=>{const rows=[...accepted.values()].filter(r=>r.entry===entry);return{entry,recorded:rows.length,success:rows.filter(r=>r.businessGoalPassed).length,jevAlone:rows.filter(r=>r.businessGoalPassed&&r.handoffs===0).length,required:18};});
  const remaining=queue.filter(q=>!accepted.has(q.id));
  const report={version:VERSION,status:'RC',formalRuns:accepted.size,perEntry,remaining,rejected,releasePassed:false,note:'54 次业务运行之外，还必须检查三个长任务、零错误完成/越权/重放、无 TUN、默认调用和18组耗时对照。未有全部独立证据，发布状态保持 RC。'};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,remaining:remaining.length},null,2));
 }else throw Error('用法：acceptance.mjs prepare|freeze|report');
}catch(error){console.error(JSON.stringify({status:'blocked',message:error.message}));process.exitCode=1;}
