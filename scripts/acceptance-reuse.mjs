import{readFile}from'node:fs/promises';
import{resolve,join}from'node:path';
import{hash,json}from'./acceptance-evidence.mjs';

// Revalidation binds original evidence; it never rewrites a previous round.
async function bind(source,candidate){
 if(!/^1\.0-[A-Za-z0-9_-]+$/.test(source.sourceRound))throw Error('原证据轮次无效');
 const root=resolve('artifacts/acceptance',source.sourceRound),paths={freeze:join(root,'freeze.json')};
 const frozen=await json(paths.freeze),{protocolHash,...payload}=frozen;
 if(hash(payload)!==protocolHash)throw Error('原冻结协议已修改');
 for(const key of['sha256','buildFingerprint','toolFingerprint','version'])if(frozen.candidate[key]!==candidate[key])throw Error('不同候选包不能复用证据');
 let job;
 if(source.id){
  if(!/^(gpt|pi|codex-cli|platform)\/[A-Za-z0-9_/-]+$/.test(source.id)||source.id.includes('..'))throw Error('原任务编号无效');
  const directory=join(root,'jobs',source.id);paths.context=join(directory,'context.json');job=await json(paths.context);
  if(job.id!==source.id||job.protocolHash!==protocolHash||job.packageSHA256!==candidate.sha256)throw Error('原任务身份不一致');
  // Transported Windows/Linux receipts retain the guest context verbatim.
  // Read evidence only from the constrained local archive, never its guest path.
  job={...job,directory};
  paths.native=join(directory,'native.jsonl');paths.observer=join(directory,'observer.jsonl');paths.prompt=join(directory,'prompt.txt');
 }
 if(source.journal){if(!/^(platform|lifecycle)\/(macos-arm64|windows-arm64|linux-arm64)\/(platform|lifecycle)\.jsonl$/.test(source.journal))throw Error('平台证据路径无效');paths.journal=join(root,source.journal);}
 const digests=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>[key,hash(await readFile(path))])));
 return{proof:{...source,protocolHash,paths,digests},frozen,job,paths};
}
export async function bindReuse(spec,candidate){
 const jobs={},journals={};for(const[id,source]of Object.entries(spec.jobs||{})){if(id!==source.id)throw Error('复核任务编号不一致');jobs[id]=(await bind(source,candidate)).proof;}
 for(const[name,items]of Object.entries(spec.journals||{})){journals[name]={};for(const[platform,source]of Object.entries(items))journals[name][platform]=(await bind(source,candidate)).proof;}
 return{jobs,journals};
}
export async function resolveReuse(proof,candidate){
 const source={sourceRound:proof.sourceRound,...(proof.id?{id:proof.id}:{}),...(proof.journal?{journal:proof.journal}:{})},result=await bind(source,candidate);
 if(hash(result.proof)!==hash(proof))throw Error('复核绑定的原始证据发生变化');return result;
}
