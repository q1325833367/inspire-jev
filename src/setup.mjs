import {join,resolve} from 'node:path';
import {copyFile,access} from 'node:fs/promises';
import {settings,defaultHome} from './config.mjs';
import {readCredentials,writeCredentials,publicCredentials,providerKeys} from './credentials.mjs';
import {atomicJSON} from './storage.mjs';
import {prompt} from './prompt.mjs';
import {secureDirectory} from './platform.mjs';

export async function saveSettings(value){
  if(value.browserMode&&!['owned','extension'].includes(value.browserMode))throw Error('浏览器模式必须为 owned 或 extension');
  if(value.extensionBrowser&&!['chrome','msedge'].includes(value.extensionBrowser))throw Error('已有浏览器必须为 chrome 或 msedge');
  if(value.extensionProfile&&(typeof value.extensionProfile!=='string'||/[\\/\r\n]/.test(value.extensionProfile)))throw Error('扩展档案应为目录名称，不能是路径');
  for(const key of ['modelProxy','browserProxy'])if(value[key]){const u=new URL(value[key]);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('代理应为不含凭据的 HTTP 地址');}
  const home=value.home||defaultHome(),path=join(home,'config.json');await secureDirectory(home);
  try{await access(path);const dir=join(home,'private-backups');await secureDirectory(dir);await copyFile(path,join(dir,`config-${Date.now()}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
  const {home:_,host,version,extensionToken,...persisted}=value;await atomicJSON(path,persisted);return settings({home});
}
export async function configure({envFile,modelProxy,browserProxy,entry,browserMode,extensionProfile,extensionBrowser,nonInteractive=false}={}){
  const current=await settings();
  if(envFile){await readCredentials(resolve(envFile));const config=await saveSettings({...current,envFile:resolve(envFile),modelProxy:modelProxy??current.modelProxy,browserProxy:browserProxy??current.browserProxy,browserMode:browserMode??current.browserMode,extensionProfile:extensionProfile??current.extensionProfile,extensionBrowser:extensionBrowser??current.extensionBrowser,trace:false});return{config,entry};}
  if(nonInteractive)throw Error('自动配置需要 --env-file，或通过环境变量配置后直接运行 mcp');
  const values=await readCredentials(current.envFile,{requireKey:false});
  values.JEV_PROVIDER=await prompt('决策服务 typesafe（云端）/local（本地）',{defaultValue:values.JEV_PROVIDER});
  if(values.JEV_PROVIDER==='local'){
    const previous=values.LOCAL_JEV_ENGINE;
    values.LOCAL_JEV_ENGINE=await prompt('本地引擎 laya/kev/semif/custom',{defaultValue:previous});
    const preset={laya:{model:'multilingual',port:8769},kev:{model:'kev-latest',port:8770},semif:{model:'semif-local',port:8772}}[values.LOCAL_JEV_ENGINE];
    if(values.LOCAL_JEV_ENGINE!==previous&&preset){values.LOCAL_JEV_MODEL=preset.model;values.LOCAL_JEV_BASE_URL=`http://127.0.0.1:${preset.port}/v1/systemone`;}
    values.LOCAL_JEV_BASE_URL=await prompt('本地 Jev 兼容接口地址（含 /v1/systemone）',{defaultValue:values.LOCAL_JEV_BASE_URL});
    values.LOCAL_JEV_MODEL=await prompt('本地模型标识',{defaultValue:values.LOCAL_JEV_MODEL});
    values.LOCAL_JEV_API_KEY=await prompt('本地服务 API key，未启用鉴权可留空',{secret:true,defaultValue:values.LOCAL_JEV_API_KEY||''});
  }else if(values.JEV_PROVIDER==='typesafe'){
    values.TYPESAFE_API_KEY=await prompt('TypeSafe API key',{secret:true,defaultValue:values.TYPESAFE_API_KEY||''});if(!values.TYPESAFE_API_KEY)throw Error('TypeSafe API key 不能为空');
    values.TYPESAFE_BASE_URL=await prompt('TypeSafe API 地址',{defaultValue:values.TYPESAFE_BASE_URL});values.TYPESAFE_MODEL=await prompt('Jev 模型',{defaultValue:values.TYPESAFE_MODEL});
  }else throw Error('决策服务必须为 typesafe 或 local');
  const text=await prompt('配置文本生成模型？y/n',{defaultValue:values.TEXT_MODEL_API_KEY?'y':'n'});
  if(/^(y|yes|是)$/i.test(text)){values.TEXT_MODEL_API_KEY=await prompt('文本模型 API key',{secret:true,defaultValue:values.TEXT_MODEL_API_KEY||''});values.TEXT_MODEL_BASE_URL=await prompt('文本模型 API 地址',{defaultValue:values.TEXT_MODEL_BASE_URL});values.TEXT_MODEL=await prompt('文本模型名称',{defaultValue:values.TEXT_MODEL});}
  const mode=browserMode??await prompt('浏览器模式 owned（独立）/extension（已有标签页）',{defaultValue:current.browserMode||'owned'});
  if(!['owned','extension'].includes(mode))throw Error('浏览器模式必须为 owned 或 extension');
  const profile=mode==='extension'?(extensionProfile??await prompt('Chrome 档案目录名称（chrome://version 的 Profile Path 最后一段）',{defaultValue:current.extensionProfile||'Default'})):current.extensionProfile;
  const channel=mode==='extension'?(extensionBrowser??await prompt('已有浏览器 chrome/msedge',{defaultValue:current.extensionBrowser||'chrome'})):current.extensionBrowser;
  if(mode==='extension')values.PLAYWRIGHT_MCP_EXTENSION_TOKEN=await prompt('官方扩展连接 token，留空则每次由浏览器确认',{secret:true,defaultValue:values.PLAYWRIGHT_MCP_EXTENSION_TOKEN||''});
  await readCredentials(undefined,{environment:values});const credentials=await writeCredentials(current.home,values);
  const model=modelProxy??await prompt('模型 HTTP 代理，留空直连',{defaultValue:current.modelProxy||''}),browser=browserProxy??await prompt('浏览器 HTTP 代理，留空直连',{defaultValue:current.browserProxy||''});
  const selected=entry??await prompt('安装入口 gpt/pi/mcp/all/none',{defaultValue:'none'});if(!['gpt','pi','mcp','all','none'].includes(selected))throw Error('无效安装入口');
  const config=await saveSettings({...current,envFile:credentials,modelProxy:model||null,browserProxy:browser||null,browserMode:mode,extensionProfile:profile,extensionBrowser:channel,trace:false});return{config,entry:selected};
}
export async function configCommand(action,key,{stdin=false}={}){
  const config=await settings(),values=await readCredentials(config.envFile,{requireKey:false});
  if(action==='show')return{home:config.home,models:publicCredentials(values),modelProxy:config.modelProxy,browserProxy:config.browserProxy,browserMode:config.browserMode||'owned',extensionProfile:config.extensionProfile||'Default',extensionBrowser:config.extensionBrowser||'chrome',trace:config.trace,activeRelease:config.activeRelease};
  if(!['set','unset'].includes(action))throw Error('用法：config show|set 名称|unset 名称');
  if(!providerKeys.includes(key)&&!['modelProxy','browserProxy','browserMode','extensionProfile','extensionBrowser'].includes(key))throw Error('未知配置项');
  let value='';if(action==='set'){if(stdin){for await(const chunk of process.stdin)value+=chunk;value=value.trim();if(!value)throw Error('标准输入为空');}else value=await prompt(key,{secret:/_API_KEY$|_TOKEN$/.test(key)});if(/[\r\n]/.test(value))throw Error('配置值不能含换行');}
  if(providerKeys.includes(key)){const stored=await readCredentials(config.envFile,{environment:{},requireKey:false});if(action==='unset')delete stored[key];else stored[key]=value;await readCredentials(undefined,{environment:stored,requireKey:false});const envFile=await writeCredentials(config.home,stored);await saveSettings({...config,envFile});}
  else await saveSettings({...config,[key]:value||null});
  return{updated:key,secret:/_API_KEY$|_TOKEN$/.test(key),configured:action==='set'};
}
