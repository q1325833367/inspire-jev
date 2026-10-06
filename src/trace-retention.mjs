import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

const metaPath = file => `${file}.meta.json`;
function save(file, value) {
  const path=metaPath(file),temp=`${path}.${randomUUID()}.tmp`;
  writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});renameSync(temp,path);return value;
}
export function traceState(file) {
  return JSON.parse(readFileSync(metaPath(file),'utf8'));
}
export function trackTrace(file, fields = {}) {
  const previous=existsSync(metaPath(file))?traceState(file):{};
  return save(file,{schema_version:1,file:basename(file),created_at:Date.now(),review_status:'unresolved',active:false,recording:'enabled',...previous,...fields});
}
export function resolveTrace(file, {reason,evidence} = {}) {
  const state=traceState(file);
  if(state.active)throw new Error('运行中的日志不能标记为已排查');
  if(!reason?.trim()||!evidence?.trim())throw new Error('标记已排查需要结论和证据路径');
  return save(file,{...state,review_status:'resolved',resolved_at:Date.now(),resolution:reason,evidence});
}
export function pinTrace(file,pinned=true) { return save(file,{...traceState(file),pinned:Boolean(pinned)}); }

// Missing/malformed metadata, unresolved, pinned and active logs are protected.
// Only explicitly reviewed logs enter the TTL/count/bytes policy.
export function cleanupTraceLogs(directory,{now=Date.now(),maxAgeMs=7*86400000,maxResolved=20,maxBytes=100*1024*1024,dryRun=false}={}) {
  const report={deleted:[],eligible:[],protected:[],protected_bytes:0,remaining_bytes:0,over_budget:false,dry_run:dryRun};
  if(!existsSync(directory))return report;
  const candidates=[];
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.jsonl'))){
    const file=join(directory,name),info=statSync(file);if(!info.isFile())continue;
    let state;try{state=traceState(file);}catch{}
    report.remaining_bytes+=info.size;
    if(!state||state.active||state.pinned||state.review_status!=='resolved'){
      report.protected.push({file:name,reason:!state?'missing_metadata':state.active?'active':state.pinned?'pinned':'unresolved',bytes:info.size});report.protected_bytes+=info.size;continue;
    }
    candidates.push({file,name,size:info.size,reviewedAt:state.resolved_at||now});
  }
  candidates.sort((a,b)=>a.reviewedAt-b.reviewedAt);
  let retained=candidates.length;
  for(const c of candidates){
    if(now-c.reviewedAt<maxAgeMs&&retained<=maxResolved&&report.remaining_bytes<=maxBytes)continue;
    report.eligible.push(c.name);
    if(!dryRun){unlinkSync(c.file);unlinkSync(metaPath(c.file));report.deleted.push(c.name);}
    report.remaining_bytes-=c.size;retained--;
  }
  report.over_budget=report.remaining_bytes>maxBytes;
  return report;
}
