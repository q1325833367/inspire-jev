import test from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';
import{hash,exclusiveJSON}from'../scripts/acceptance-evidence.mjs';
import{bindReuse,resolveReuse}from'../scripts/acceptance-reuse.mjs';

test('同包原证据复核绑定原协议与文件；换包、改证据和路径越界拒收',async()=>{
 const cwd=process.cwd(),dir=await mkdtemp(join(tmpdir(),'inspire-reuse-'));process.chdir(dir);
 try{
  const round='1.0-test',id='gpt/wiki-fields/1',root=join(dir,'artifacts/acceptance',round),jobDir=join(root,'jobs',id),candidate={version:'1.0.0',sha256:'package',buildFingerprint:'build',toolFingerprint:'tools'};
  const frozen={candidate};frozen.protocolHash=hash(frozen);await exclusiveJSON(join(root,'freeze.json'),frozen);
  await exclusiveJSON(join(jobDir,'context.json'),{id,directory:jobDir,protocolHash:frozen.protocolHash,packageSHA256:candidate.sha256});
  for(const file of['observer.jsonl','native.jsonl','prompt.txt'])await writeFile(join(jobDir,file),'original\n');
  const spec={jobs:{[id]:{sourceRound:round,id}}},bound=await bindReuse(spec,candidate),proof=bound.jobs[id];
  assert.equal((await resolveReuse(proof,candidate)).frozen.protocolHash,frozen.protocolHash);
  await assert.rejects(bindReuse(spec,{...candidate,sha256:'other'}),/不同候选包/);
  await assert.rejects(bindReuse({jobs:{'gpt/../x':{sourceRound:round,id:'gpt/../x'}}},candidate),/编号无效/);
  await writeFile(join(jobDir,'native.jsonl'),'changed\n');await assert.rejects(resolveReuse(proof,candidate),/发生变化/);
  assert.equal(proof.digests.native,hash('original\n'));
 }finally{process.chdir(cwd);await rm(dir,{recursive:true,force:true});}
});
