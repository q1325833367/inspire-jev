import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrace } from '../src/trace.mjs';
import { localTrace } from '../src/runtime.mjs';
import { trackTrace, resolveTrace, cleanupTraceLogs, traceState } from '../src/trace-retention.mjs';
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'jev-retention-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('正常使用默认关闭追踪',()=>assert.equal(localTrace(),undefined));
test('容量与时间压力下仍保护未排查、运行中、固定及无元数据的日志',async t=>{
  const dir=await directory(t),now=Date.now();
  for(const name of ['unresolved','active','pinned','legacy','resolved']){
    const file=join(dir,`${name}.jsonl`);await writeFile(file,'old evidence\n');
    if(name!=='legacy')trackTrace(file,{review_status:name==='unresolved'?'unresolved':'resolved',active:name==='active',pinned:name==='pinned',resolved_at:now-20*86400000});
  }
  const preview=cleanupTraceLogs(dir,{now,maxBytes:1,maxResolved:0,dryRun:true});assert.deepEqual(preview.eligible,['resolved.jsonl']);assert.ok(existsSync(join(dir,'resolved.jsonl')));
  const report=cleanupTraceLogs(dir,{now,maxBytes:1,maxResolved:0});assert.deepEqual(report.deleted,['resolved.jsonl']);assert.equal(report.protected.length,4);assert.equal(report.over_budget,true);
  for(const name of ['unresolved','active','pinned','legacy'])assert.ok(existsSync(join(dir,`${name}.jsonl`)));
});
test('关闭不等于已排查；结论和证据都齐全后才允许清理',async t=>{
  const dir=await directory(t),file=join(dir,'case.jsonl'),trace=createTrace({filePath:file,heartbeatMs:0});
  assert.throws(()=>resolveTrace(file,{reason:'原因已查明',evidence:'proof.md'}),/运行中/);
  trace.close();assert.equal(traceState(file).review_status,'unresolved');assert.throws(()=>resolveTrace(file,{reason:'原因已查明'}),/证据/);
  assert.equal(cleanupTraceLogs(dir,{maxResolved:0}).deleted.length,0);
  resolveTrace(file,{reason:'原因已查明',evidence:'proof.md'});assert.deepEqual(cleanupTraceLogs(dir,{maxResolved:0}).deleted,['case.jsonl']);
});
test('达到单文件上限停止追加并标记，证据完整保留',async t=>{
  const dir=await directory(t),file=join(dir,'bounded.jsonl'),trace=createTrace({filePath:file,maxFileBytes:2048,heartbeatMs:0});
  for(let i=0;i<40;i++)trace.event('start','test',{note:'x'.repeat(100)});
  const before=await readFile(file,'utf8');trace.event('end','later');assert.equal(await readFile(file,'utf8'),before);
  assert.ok((await stat(file)).size<=2048);assert.ok(before.includes('trace.recording.stopped'));assert.equal(trace.status.recording,'stopped');
  trace.close();assert.equal(traceState(file).review_status,'unresolved');assert.equal(cleanupTraceLogs(dir,{maxBytes:1}).deleted.length,0);
});
test('目录超限时不删除未排查证据，新测试停止记录',async t=>{
  const dir=await directory(t),old=join(dir,'old.jsonl');await writeFile(old,'x'.repeat(4096));trackTrace(old,{review_status:'unresolved'});
  const file=join(dir,'new.jsonl'),trace=createTrace({filePath:file,maxDirectoryBytes:2048,heartbeatMs:0});
  trace.event('start','test');assert.equal(trace.status.recording,'stopped');assert.ok(existsSync(old));assert.equal((await stat(file)).size,0);trace.close();
});
