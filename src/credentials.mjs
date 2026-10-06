import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {secureDirectory,secureFile} from './platform.mjs';

export const providerKeys=['TYPESAFE_API_KEY','TYPESAFE_BASE_URL','TYPESAFE_MODEL','TEXT_MODEL_API_KEY','TEXT_MODEL_BASE_URL','TEXT_MODEL'];
export const providerDefaults={TYPESAFE_BASE_URL:'https://api.typesafe.ai/v1/systemone',TYPESAFE_MODEL:'jev-latest',TEXT_MODEL_BASE_URL:'https://api.deepseek.com/v1',TEXT_MODEL:'deepseek-chat'};
export async function readCredentials(envFile,{environment=process.env,requireKey=true}={}){
  const file=envFile?parseEnv(await readFile(envFile,'utf8')):{};
  const result={...providerDefaults};
  for(const key of providerKeys){if(file[key]!==undefined)result[key]=file[key];if(environment[key]!==undefined)result[key]=environment[key];}
  for(const key of providerKeys)if(result[key]!==undefined){result[key]=result[key].trim();if(/[\r\n]/.test(result[key]))throw Error('模型配置不能含换行');}
  if(requireKey&&!result.TYPESAFE_API_KEY)throw Object.assign(Error('缺少 TypeSafe key；运行 inspire-jev setup'),{code:'MISSING_TYPESAFE_KEY'});
  for(const key of ['TYPESAFE_BASE_URL','TEXT_MODEL_BASE_URL'])if(result[key]){const u=new URL(result[key]);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('模型地址应为不含凭据的 HTTP(S) URL');}
  return result;
}
export async function writeCredentials(home,values){
  await secureDirectory(home);
  const path=join(home,'credentials.env'),temporary=`${path}.${randomUUID()}.tmp`;
  const text=providerKeys.filter(k=>values[k]!==undefined).map(k=>`${k}=${JSON.stringify(String(values[k]))}`).join('\n')+'\n';
  try{await writeFile(temporary,text,{mode:0o600});await secureFile(temporary);await rename(temporary,path);await secureFile(path);}
  finally{await rm(temporary,{force:true});}
  return path;
}
export function publicCredentials(values){return Object.fromEntries(providerKeys.map(key=>[key,key.endsWith('_API_KEY')?(values[key]?'已配置':'未配置'):(values[key]||'')]));}
