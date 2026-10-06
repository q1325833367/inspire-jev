import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {VERSION} from '../src/config.mjs';
import {acceptanceEntries as entries,acceptanceQueue as queue,evaluateAcceptance} from './acceptance-gates.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const directory='artifacts/acceptance',command=process.argv[2]||'report';await mkdir(directory,{recursive:true});
const read=async name=>{try{return JSON.parse(await readFile(join(directory,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
try{
 if(command==='prepare'){
  const proposal={version:VERSION,status:'draft',notFormalEvidence:true,queue,requirements:'docs/ACCEPTANCE.md',frozen:false};await writeFile(join(directory,'queue.json'),JSON.stringify(proposal,null,2));console.log(JSON.stringify({status:'draft',runs:queue.length,path:join(directory,'queue.json'),note:'先通过 M2，再冻结正式协议。'},null,2));
 }else if(command==='freeze'){
  const pre=await read('prerequisites.json'),missing=entries.flatMap(entry=>['hostModelVerified','noTunVerified','manualLoginResumeVerified'].filter(key=>pre?.[entry]?.[key]!==true).map(key=>`${entry}.${key}`));
  if(missing.length)throw Error('M2 证据未齐，不能冻结正式验收：'+missing.join('、'));
  if(await read('freeze.json'))throw Error('已有冻结记录；修改须建立新验收目录，保留原失败');
  const paths=['package-lock.json','package.json','plugin.json','scripts/acceptance-gates.mjs','scripts/business-verifiers.mjs','scripts/public-cases.mjs','scripts/long-gutenberg.mjs','docs/ACCEPTANCE.md','skills/jev-browser/SKILL.md','integrations/pi/index.ts',...(await readdir('src')).filter(name=>/\.(mjs|ts)$/.test(name)).map(name=>join('src',name))];
  const files=Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
  const naturalPrompts=await read('natural-prompts.json'),hostSettings=await read('host-settings.json'),githubForm=await read('github-form.json'),comparisonProtocol=await read('comparison-protocol.json');
  if(!Array.isArray(naturalPrompts)||naturalPrompts.length!==10||new Set(naturalPrompts.map(p=>p.id)).size!==10||naturalPrompts.some(p=>typeof p.id!=='string'||typeof p.goal!=='string'||!p.goal.trim()||/jev/i.test(p.goal)))throw Error('需要冻结十条完整自然请求，不包含 Jev 名称');
  if(!hostSettings||!githubForm||!comparisonProtocol)throw Error('需要冻结宿主设置、实际登录表单检查器和交替对照协议');
  const frozen={version:VERSION,at:new Date().toISOString(),queue,files,prerequisites:pre,naturalPrompts,hostSettings,githubForm,comparisonProtocol};frozen.protocolHash=sha(JSON.stringify(frozen));await writeFile(join(directory,'freeze.json'),JSON.stringify(frozen,null,2),{flag:'wx'});console.log(JSON.stringify({status:'frozen',protocolHash:frozen.protocolHash,runs:queue.length}));
 }else if(command==='report'){
  const frozen=await read('freeze.json'),records=await read('runs.json')||[],extras=await read('gates.json')||{},verified=new Set();
  for(const row of [...records,...(extras.longRuns||[]),...(extras.defaultSelection||[]),...(extras.comparisons||[])]){
   try{if(typeof row.evidencePath==='string'&&/^[a-f0-9]{64}$/.test(row.evidenceSHA256||'')&&sha(await readFile(row.evidencePath))===row.evidenceSHA256)verified.add(row);}catch{}
  }
  const {protocolHash,...contents}=frozen||{};
  const integrity=frozen&&sha(JSON.stringify(contents))===protocolHash&&JSON.stringify(Object.fromEntries(await Promise.all(Object.entries(frozen.files).map(async([path])=>[path,sha(await readFile(path))]))))===JSON.stringify(frozen.files);
  const evaluated=evaluateAcceptance({frozen:integrity?frozen:null,records,extras,evidenceVerified:row=>verified.has(row)});
  const report={...evaluated,version:frozen?.version||VERSION,status:evaluated.releasePassed?'acceptance_passed':'RC',sourceIntegrity:Boolean(integrity),note:'开发集、构建和单测不计入正式验收；任一发布门槛缺失或失败时保持 RC。'};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,remaining:report.remaining.length},null,2));
 }else throw Error('用法：acceptance.mjs prepare|freeze|report');
}catch(error){console.error(JSON.stringify({status:'blocked',message:error.message}));process.exitCode=1;}
