import {join,resolve} from 'node:path';
import {copyFile,access} from 'node:fs/promises';
import {settings,defaultHome} from './config.mjs';
import {readCredentials,writeCredentials,publicCredentials,providerKeys} from './credentials.mjs';
import {atomicJSON} from './storage.mjs';
import {prompt} from './prompt.mjs';
import {secureDirectory} from './platform.mjs';

export async function saveSettings(value){
  for(const key of ['modelProxy','browserProxy'])if(value[key]){const u=new URL(value[key]);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('代理应为不含凭据的 HTTP 地址');}
  const home=value.home||defaultHome(),path=join(home,'config.json');await secureDirectory(home);
  try{await access(path);const dir=join(home,'private-backups');await secureDirectory(dir);await copyFile(path,join(dir,`config-${Date.now()}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
  const {home:_,host,version,...persisted}=value;await atomicJSON(path,persisted);return settings({home});
}
export async function configure({envFile,modelProxy,browserProxy,entry,nonInteractive=false}={}){
  const current=await settings();
  if(envFile){await readCredentials(resolve(envFile));const config=await saveSettings({...current,envFile:resolve(envFile),modelProxy:modelProxy??current.modelProxy,browserProxy:browserProxy??current.browserProxy,trace:false});return{config,entry};}
  if(nonInteractive)throw Error('自动配置需要 --env-file，或通过环境变量配置后直接运行 mcp');
  const values=await readCredentials(current.envFile,{requireKey:false});
  values.TYPESAFE_API_KEY=await prompt('TypeSafe API key',{secret:true,defaultValue:values.TYPESAFE_API_KEY||''});if(!values.TYPESAFE_API_KEY)throw Error('TypeSafe API key 不能为空');
  values.TYPESAFE_BASE_URL=await prompt('TypeSafe API 地址',{defaultValue:values.TYPESAFE_BASE_URL});values.TYPESAFE_MODEL=await prompt('Jev 模型',{defaultValue:values.TYPESAFE_MODEL});
  const text=await prompt('配置文本生成模型？y/n',{defaultValue:values.TEXT_MODEL_API_KEY?'y':'n'});
  if(/^(y|yes|是)$/i.test(text)){values.TEXT_MODEL_API_KEY=await prompt('文本模型 API key',{secret:true,defaultValue:values.TEXT_MODEL_API_KEY||''});values.TEXT_MODEL_BASE_URL=await prompt('文本模型 API 地址',{defaultValue:values.TEXT_MODEL_BASE_URL});values.TEXT_MODEL=await prompt('文本模型名称',{defaultValue:values.TEXT_MODEL});}
  await readCredentials(undefined,{environment:values});const credentials=await writeCredentials(current.home,values);
  const model=modelProxy??await prompt('模型 HTTP 代理，留空直连',{defaultValue:current.modelProxy||''}),browser=browserProxy??await prompt('浏览器 HTTP 代理，留空直连',{defaultValue:current.browserProxy||''});
  const selected=entry??await prompt('安装入口 gpt/pi/mcp/all/none',{defaultValue:'none'});if(!['gpt','pi','mcp','all','none'].includes(selected))throw Error('无效安装入口');
  const config=await saveSettings({...current,envFile:credentials,modelProxy:model||null,browserProxy:browser||null,trace:false});return{config,entry:selected};
}
export async function configCommand(action,key,{stdin=false}={}){
  const config=await settings(),values=await readCredentials(config.envFile,{requireKey:false});
  if(action==='show')return{home:config.home,models:publicCredentials(values),modelProxy:config.modelProxy,browserProxy:config.browserProxy,trace:config.trace,activeRelease:config.activeRelease};
  if(!['set','unset'].includes(action))throw Error('用法：config show|set 名称|unset 名称');
  if(!providerKeys.includes(key)&&!['modelProxy','browserProxy'].includes(key))throw Error('未知配置项');
  let value='';if(action==='set'){if(stdin){for await(const chunk of process.stdin)value+=chunk;value=value.trim();if(!value)throw Error('标准输入为空');}else value=await prompt(key,{secret:key.endsWith('_API_KEY')});if(/[\r\n]/.test(value))throw Error('配置值不能含换行');}
  if(providerKeys.includes(key)){const stored=await readCredentials(config.envFile,{environment:{},requireKey:false});if(action==='unset')delete stored[key];else stored[key]=value;await readCredentials(undefined,{environment:stored,requireKey:false});const envFile=await writeCredentials(config.home,stored);await saveSettings({...config,envFile});}
  else await saveSettings({...config,[key]:value||null});
  return{updated:key,secret:key.endsWith('_API_KEY'),configured:action==='set'};
}
