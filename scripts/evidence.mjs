import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';

export const testEntry=()=>process.env.JEV_TEST_ENTRY||resolve('src/cli.mjs');
export async function writeReport(name,report){
  await mkdir('artifacts/history',{recursive:true});
  const immutable=`artifacts/history/${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}-${name}`;
  const value=JSON.stringify({...report,entry:testEntry(),immutable},null,2);
  await writeFile(immutable,value,{flag:'wx',mode:0o600});
  await writeFile(`artifacts/${name}`,value,{mode:0o600});
  return immutable;
}
