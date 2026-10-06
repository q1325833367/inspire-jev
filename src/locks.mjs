import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {processIdentity,secureDirectory} from './platform.mjs';
const base = join(tmpdir(),'jev-agent-v2-locks');
const filename = identity => join(base,`${createHash('sha256').update(identity).digest('hex')}.lock`);
const born=processIdentity;
export async function inspectLock(identity) {
  let record;try{record=JSON.parse(await readFile(filename(identity),'utf8'));}catch(e){if(e.code==='ENOENT')return{exists:false};return{exists:true,unknown:true};}
  if(record.identity!==identity||typeof record.token!=='string'||!Number.isInteger(record.pid)||record.pid<=0||typeof record.processStarted!=='string'||!record.processStarted)return{exists:true,unknown:true};
  let actual;try{actual=await born(record.pid);}catch(e){return{exists:true,unknown:true,reason:e.code};}
  return{exists:true,...record,ownerAlive:!!actual&&actual===record.processStarted};
}
export async function acquire(identity,runId) {
  await secureDirectory(base);
  const path=filename(identity),token=randomUUID();let file;
  const processStarted=await born(process.pid);if(!processStarted)throw Error('无法取得锁持有进程身份');
  try{file=await open(path,'wx',0o600);await file.writeFile(JSON.stringify({identity,runId,token,pid:process.pid,processStarted,startedAt:Date.now()}));}
  catch(e){if(e.code==='EEXIST')throw Object.assign(new Error('该物理标签页已有写入任务；先检查锁与现场'),{code:'TAB_BUSY',details:await inspectLock(identity)});throw e;}
  finally{await file?.close();}
  let releasing;return ()=>releasing??=(async()=>{const current=JSON.parse(await readFile(path,'utf8'));if(current.token!==token)throw Error('锁持有者已改变');await unlink(path);})();
}
export async function recoverLock(identity,{inspected=false}={}) {
  const record=await inspectLock(identity);
  if(!record.exists)return record;
  if(!inspected||record.unknown||record.ownerAlive)throw Error('不能回收未核对、损坏或仍存活的锁');
  const confirm=await inspectLock(identity);
  if(confirm.unknown||confirm.token!==record.token||confirm.ownerAlive)throw Error('锁现场已改变');
  await unlink(filename(identity));return{recovered:true,runId:record.runId};
}
