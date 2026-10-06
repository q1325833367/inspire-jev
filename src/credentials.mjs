import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {secureDirectory,secureFile} from './platform.mjs';

export const providerKeys=['JEV_PROVIDER','LOCAL_JEV_ENGINE','TYPESAFE_API_KEY','TYPESAFE_BASE_URL','TYPESAFE_MODEL','LOCAL_JEV_BASE_URL','LOCAL_JEV_MODEL','LOCAL_JEV_API_KEY','LOCAL_JEV_TIMEOUT_MS','TEXT_MODEL_API_KEY','TEXT_MODEL_BASE_URL','TEXT_MODEL','PLAYWRIGHT_MCP_EXTENSION_TOKEN'];
export const providerDefaults={JEV_PROVIDER:'typesafe',LOCAL_JEV_ENGINE:'laya',TYPESAFE_BASE_URL:'https://api.typesafe.ai/v1/systemone',TYPESAFE_MODEL:'jev-latest',LOCAL_JEV_BASE_URL:'http://127.0.0.1:8769/v1/systemone',LOCAL_JEV_MODEL:'multilingual',LOCAL_JEV_TIMEOUT_MS:'25000',TEXT_MODEL_BASE_URL:'https://api.deepseek.com/v1',TEXT_MODEL:'deepseek-chat'};
export function decisionEndpoint(config){
  const provider=config.JEV_PROVIDER||'typesafe';
  if(!['typesafe','local'].includes(provider))throw Error('JEV_PROVIDER 必须为 typesafe 或 local');
  const local=provider==='local',timeoutMs=local?Number(config.LOCAL_JEV_TIMEOUT_MS||25000):25000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error('LOCAL_JEV_TIMEOUT_MS 应为 100–120000 毫秒');
  const engine=config.LOCAL_JEV_ENGINE||'laya';if(!['laya','kev','semif','custom'].includes(engine))throw Error('LOCAL_JEV_ENGINE 必须为 laya、kev、semif 或 custom');
  return{provider,engine:local?engine:undefined,url:local?(config.LOCAL_JEV_BASE_URL||providerDefaults.LOCAL_JEV_BASE_URL):(config.TYPESAFE_BASE_URL||providerDefaults.TYPESAFE_BASE_URL),key:local?config.LOCAL_JEV_API_KEY:config.TYPESAFE_API_KEY,model:local?(config.LOCAL_JEV_MODEL||providerDefaults.LOCAL_JEV_MODEL):(config.TYPESAFE_MODEL||providerDefaults.TYPESAFE_MODEL),timeoutMs};
}
export async function readCredentials(envFile,{environment=process.env,requireKey=true}={}){
  const file=envFile?parseEnv(await readFile(envFile,'utf8')):{};
  const result={...providerDefaults};
  for(const key of providerKeys){if(file[key]!==undefined)result[key]=file[key];if(environment[key]!==undefined)result[key]=environment[key];}
  for(const key of providerKeys)if(result[key]!==undefined){result[key]=result[key].trim();if(/[\r\n]/.test(result[key]))throw Error('模型配置不能含换行');}
  const endpoint=decisionEndpoint(result);
  if(requireKey&&endpoint.provider==='typesafe'&&!endpoint.key)throw Object.assign(Error('缺少 TypeSafe key；运行 inspire-jev setup'),{code:'MISSING_TYPESAFE_KEY'});
  for(const key of ['TYPESAFE_BASE_URL','LOCAL_JEV_BASE_URL','TEXT_MODEL_BASE_URL'])if(result[key]){const u=new URL(result[key]);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('模型地址应为不含凭据的 HTTP(S) URL');}
  return result;
}
export async function writeCredentials(home,values){
  await secureDirectory(home);
  const path=join(home,'credentials.env'),temporary=`${path}.${randomUUID()}.tmp`;
  const text=providerKeys.filter(k=>values[k]!==undefined).map(k=>`${k}=${quoteEnv(String(values[k]))}`).join('\n')+'\n';
  try{await writeFile(temporary,text,{mode:0o600});await secureFile(temporary);await rename(temporary,path);await secureFile(path);}
  finally{await rm(temporary,{force:true});}
  return path;
}
function quoteEnv(value){
  if(/[\r\n]/.test(value))throw Error('模型配置不能含换行');
  for(const quote of ["'",'"','`','']){
    const candidate=quote+value+quote;
    if(parseEnv('VALUE='+candidate).VALUE===value)return candidate;
  }
  throw Error('配置值无法无损保存为 env 格式');
}
export function publicCredentials(values){return Object.fromEntries(providerKeys.map(key=>[key,/_API_KEY$|_TOKEN$/.test(key)?(values[key]?'已配置':'未配置'):(values[key]||'')]));}
