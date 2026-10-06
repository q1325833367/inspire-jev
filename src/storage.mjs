import {mkdir, readFile, writeFile, rename, readdir, stat, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {cleanupTraceLogs} from './trace-retention.mjs';
import {secureDirectory} from './platform.mjs';

export async function atomicJSON(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value), {mode:0o600});
  await rename(tmp,path);
}
export const safeId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('无效编号');
  return value;
};
export class Store {
  constructor(home, host) {this.root=join(home,'hosts',safeId(host));}
  async init() {await secureDirectory(this.root);for (const part of ['runs', 'sessions', 'profiles', 'locks', 'traces','requests','supervisor']) await mkdir(join(this.root,part),{recursive:true,mode:0o700});return this;}
  path(type,id) {return join(this.root,type,`${safeId(id)}.json`);}
  async read(type,id) {return JSON.parse(await readFile(this.path(type,id),'utf8'));}
  async write(type,id,value) {await atomicJSON(this.path(type,id),{...value,updatedAt:Date.now()});}
  async list(type) {const rows=[];for(const n of await readdir(join(this.root,type)))if(n.endsWith('.json')){try {rows.push(JSON.parse(await readFile(join(this.root,type,n),'utf8')));}catch{}}return rows;}
  async cleanup({dryRun=true,now=Date.now()}={}) {
    const report={deleted:[],eligible:[],protected:[],protectedBytes:0,supervisorProtected:[]};
    for (const name of await readdir(join(this.root,'runs'))) {
      if(!name.endsWith('.json'))continue;
      const path=join(this.root,'runs',name);let value;
      try {value=JSON.parse(await readFile(path,'utf8'));}catch{}
      const terminal=value?.status==='verified'&&!value?.checkpoint?.pending&&!value?.active;
      if(!terminal || now-(value.finishedAt||now)<7*86400000) {report.protected.push(name);report.protectedBytes+=(await stat(path)).size;continue;}
      report.eligible.push(name);
      if(!dryRun){if(value.requestId){const request=await this.read('requests',value.requestId);await this.write('requests',value.requestId,{...request,archived:true,status:'verified',runId:value.runId});}await unlink(path);const extra=join(this.root,'..','..','checkpoints-v2',name);await unlink(extra).catch(e=>{if(e.code!=='ENOENT')throw e;});report.deleted.push(name);}
    }
    for(const name of await readdir(join(this.root,'supervisor'))){
      if(!name.endsWith('.json'))continue;
      const path=join(this.root,'supervisor',name),bytes=(await stat(path)).size;let entry;
      try{entry=JSON.parse(await readFile(path,'utf8'));}catch{}
      const resolved=entry?.effect==='effect_observed'||entry?.effect==='not_executed';
      if(resolved&&now-(entry.verifiedAt||entry.finishedAt||entry.startedAt||now)>=7*86400000){report.eligible.push('supervisor/'+name);if(!dryRun){await unlink(path);report.deleted.push('supervisor/'+name);}}
      else{report.supervisorProtected.push({file:name,reason:resolved?'retention_period':'requires_effect_verification',bytes});report.protectedBytes+=bytes;}
    }
    report.traces=cleanupTraceLogs(join(this.root,'traces'),{dryRun,now});
    return report;
  }
}
