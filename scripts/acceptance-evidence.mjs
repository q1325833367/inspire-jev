import {createHash} from 'node:crypto';
import {readFile,appendFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
export async function json(path){return JSON.parse(await readFile(path,'utf8'));}
export async function exclusiveJSON(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
export async function ledger(path){
 let previous='0'.repeat(64),sequence=0,writing=Promise.resolve();
 try{const rows=await readLedger(path);previous=rows.at(-1)?.hash||previous;sequence=rows.length;}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 let bytes=await stat(path).then(s=>s.size).catch(e=>{if(e.code==='ENOENT')return 0;throw e;});
 return event=>{writing=writing.then(async()=>{const row={sequence:sequence+1,previous,at:new Date().toISOString(),monotonicMs:performance.now(),...event};row.hash=hash(row);const line=JSON.stringify(row)+'\n';if(bytes+Buffer.byteLength(line)>10*1024*1024)throw Object.assign(Error('证据容量达到上限；保留已有待查记录'),{code:'PROTECTED_EVIDENCE_CAPACITY'});await appendFile(path,line,{mode:0o600});bytes+=Buffer.byteLength(line);sequence++;previous=row.hash;return row;});return writing;};
}
export async function readLedger(path){
 const text=await readFile(path,'utf8');if(text&&!text.endsWith('\n'))throw Error('证据最后一条未完整写入');
 const rows=text.split('\n').filter(Boolean).map(JSON.parse);let previous='0'.repeat(64);
 for(let i=0;i<rows.length;i++){const {hash:actual,...row}=rows[i];if(row.sequence!==i+1||row.previous!==previous||hash(row)!==actual)throw Error('证据链不完整或已修改');previous=actual;}
 return rows;
}
