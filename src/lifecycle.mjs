import {cp,mkdir,readFile,writeFile,rm,mkdtemp,access} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir,homedir} from 'node:os';
import {settings} from './config.mjs';
import {saveSettings} from './setup.mjs';
import {runCommand,commandAvailable,secureDirectory} from './platform.mjs';
import {atomicJSON} from './storage.mjs';

export const packageRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const entries=['gpt','pi','mcp'];
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
const inside=(root,path)=>{const part=relative(root,path);return part!==''&&!part.startsWith('..')&&!isAbsolute(part);};
async function readInstall(home){try{return JSON.parse(await readFile(join(home,'installation.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return{entries:[]};throw e;}}
async function backup(path,home){if(!await exists(path))return;const dir=join(home,'private-backups');await secureDirectory(dir);await cp(path,join(dir,`${Date.now()}-${path.endsWith('.toml')?'host.toml':'host.json'}`));}
function npmEnv(config){const proxy=config.modelProxy||config.browserProxy;return{...process.env,...(proxy?{HTTPS_PROXY:proxy,HTTP_PROXY:proxy}:{}),npm_config_audit:'false',npm_config_fund:'false'};}
async function refreshHosts(root,entry,config,{remove=false}={}){
  const cli=join(root,'src','cli.mjs'),name='inspire-jev';
  if(entry==='gpt'){
    if(!await commandAvailable('codex'))throw Object.assign(Error('GPT 插件需要可用的 Codex CLI；Pi 和通用 MCP 可独立安装'),{code:'HOST_NOT_INSTALLED'});
    const marketplace=join(config.home,'marketplaces','inspire-jev-local'),plugin=join(marketplace,'plugins',name);await backup(join(homedir(),'.codex','config.toml'),config.home);
    if(remove){runCommand('codex',['plugin','remove','inspire-jev@inspire-jev-local','--json']);return;}
    await mkdir(join(marketplace,'.agents','plugins'),{recursive:true});await mkdir(plugin,{recursive:true});await cp(join(root,'skills'),join(plugin,'skills'),{recursive:true});await cp(join(root,'plugin.json'),join(plugin,'plugin.json'));
    const manifest={$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{[name]:{type:'stdio',command:process.execPath,args:[cli,'mcp','--host','gpt']}}};
    for(const file of ['mcp.json','.mcp.json'])await writeFile(join(plugin,file),JSON.stringify(manifest,null,2)+'\n');
    await writeFile(join(marketplace,'.agents','plugins','marketplace.json'),JSON.stringify({name:'inspire-jev-local',interface:{displayName:'InspireJev'},plugins:[{name,source:{source:'local',path:'./plugins/'+name},policy:{installation:'AVAILABLE',authentication:'ON_USE'},category:'Engineering'}]},null,2)+'\n');
    runCommand('codex',['plugin','marketplace','add',marketplace,'--json']);runCommand('codex',['plugin','add','inspire-jev@inspire-jev-local','--json']);
    const {codexRPC}=await import('../scripts/codex-rpc.mjs');const rpc=await codexRPC();
    try{const result=await rpc.call('config/read',{includeLayers:false});for(const legacy of ['jev-agent@jev-agent-local','jev-browser@jev-local'])if(result.config.plugins?.[legacy]?.enabled)await rpc.call('config/value/write',{keyPath:`plugins."${legacy}".enabled`,value:false,mergeStrategy:'upsert'});}finally{rpc.close();}
  }else if(entry==='pi'){
    if(!await commandAvailable('pi'))throw Object.assign(Error('Pi 未安装；请先安装 Pi，或使用通用 MCP 入口'),{code:'HOST_NOT_INSTALLED'});
    const path=join(homedir(),'.pi','agent','settings.json');await backup(path,config.home);let previous=[];
    try{const file=JSON.parse(await readFile(path,'utf8'));for(const item of file.packages||[]){if(typeof item!=='string')continue;const old=resolve(dirname(path),item);if(old===root)continue;try{const pkg=JSON.parse(await readFile(join(old,'package.json'),'utf8'));if(['jev-agent','inspire-jev'].includes(pkg.name))previous.push(old);}catch{}}}catch(e){if(e.code!=='ENOENT')throw e;}
    if(remove){runCommand('pi',['remove',root]);return;}
    runCommand('pi',['install',root]);for(const path of previous)runCommand('pi',['remove',path]);
  }else{
    const manifest={mcpServers:{[name]:{command:process.execPath,args:[cli,'mcp','--host','mcp']}}};if(!remove)await atomicJSON(join(config.home,'mcp-client.json'),manifest);
    if(await commandAvailable('codex')){await backup(join(homedir(),'.codex','config.toml'),config.home);if(remove)runCommand('codex',['mcp','remove','inspire-jev-cli']);else{runCommand('codex',['mcp','add','inspire-jev-cli','--',process.execPath,cli,'mcp','--host','codex-cli']);const list=runCommand('codex',['mcp','list','--json'],{stdio:'pipe'});if(JSON.parse(list.stdout.toString()).some(x=>x.name==='jev-agent-cli'))runCommand('codex',['mcp','remove','jev-agent-cli']);}}
    return manifest;
  }
}
export async function installEntries({entry='all',root=packageRoot,downloadBrowser=true}={}){
  if(![...entries,'all'].includes(entry))throw Error('--entry 必须为 gpt、pi、mcp 或 all');
  const config=await settings(),pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(!['inspire-jev','jev-agent'].includes(pkg.name)||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version))throw Error('安装包身份无效');
  const release=join(config.home,'releases',pkg.version);await secureDirectory(release);
  if(resolve(root)!==resolve(release))for(const name of ['package.json','npm-shrinkwrap.json','package-lock.json','src','integrations','scripts','skills','plugin.json','mcp.json','.mcp.json','README.md','README.en.md','docs','LICENSE','NOTICE'])if(await exists(join(root,name)))await cp(join(root,name),join(release,name),{recursive:true});
  runCommand('npm',['ci','--ignore-scripts','--omit=dev'],{cwd:release,env:npmEnv(config)});
  if(downloadBrowser)runCommand(process.execPath,[join(release,'node_modules','playwright','cli.js'),'install','chromium'],{env:npmEnv(config)});
  const wanted=entry==='all'?entries:[entry],selected=[];for(const item of wanted){if(item==='mcp'||await commandAvailable(item==='gpt'?'codex':'pi'))selected.push(item);else if(entry!=='all')throw Object.assign(Error(`宿主 ${item} 未安装`),{code:'HOST_NOT_INSTALLED'});}
  const previous=await readInstall(config.home),done=[],failed=[];let mcp;
  for(const item of selected){try{const result=await refreshHosts(release,item,config);if(item==='mcp')mcp=result;done.push(item);}catch(e){failed.push({entry:item,error:e.code||e.name,message:e.message});}}
  const record={version:pkg.version,release,entries:[...new Set([...previous.entries,...done])],previousVersion:previous.version===pkg.version?previous.previousVersion:previous.version,updatedAt:new Date().toISOString()};await atomicJSON(join(config.home,'installation.json'),record);if(done.length)await saveSettings({...config,activeRelease:release});
  const result={...record,installed:done,unavailable:wanted.filter(x=>!selected.includes(x)),failed,mcp,credentialsRetained:true,profilesRetained:true};if(failed.length)throw Object.assign(Error('部分入口安装失败；已完成入口保留，可重复安装'),{code:'PARTIAL_INSTALL',details:result});return result;
}
export async function upgrade(packageInput){
  if(!packageInput)throw Error('upgrade 需要 --package 安装包路径或固定版本 URL');const config=await settings(),stage=await mkdtemp(join(tmpdir(),'inspire-jev-upgrade-'));
  try{runCommand('npm',['install','--prefix',stage,'--ignore-scripts','--no-audit','--no-fund',packageInput],{env:npmEnv(config)});const root=join(stage,'node_modules','inspire-jev');if(!await exists(join(root,'package.json')))throw Error('安装包不是 InspireJev');const previous=await readInstall(config.home);return await installEntries({root,entry:previous.entries.length===1?previous.entries[0]:'all'});}finally{await rm(stage,{recursive:true,force:true});}
}
export async function rollback(version){
  const config=await settings(),previous=await readInstall(config.home);version||=previous.previousVersion;if(!version||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw Error('rollback 需要已安装的 --version');const root=join(config.home,'releases',version);if(!await exists(join(root,'package.json')))throw Error('回退版本不在本机');return installEntries({root,entry:previous.entries.length===1?previous.entries[0]:'all'});
}
export async function uninstall({entry='all'}={}){
  if(![...entries,'all'].includes(entry))throw Error('无效卸载入口');const config=await settings(),record=await readInstall(config.home),selected=entry==='all'?record.entries:[entry],removed=[],failed=[];
  for(const item of selected){if(!record.entries.includes(item))continue;try{await refreshHosts(record.release,item,config,{remove:true});removed.push(item);}catch(e){failed.push({entry:item,error:e.code||e.name});}}
  const remaining=record.entries.filter(e=>!removed.includes(e));await atomicJSON(join(config.home,'installation.json'),{...record,entries:remaining});return{removed,remaining,failed,credentialsRetained:true,profilesRetained:true,releasesRetained:true};
}
export async function dispatchTarget(own){
  if(process.env.INSPIRE_JEV_DISPATCHED)return null;const config=await settings(),target=config.activeRelease&&join(config.activeRelease,'src','cli.mjs');if(!target||resolve(target)===resolve(own)||!inside(join(config.home,'releases'),target)||!await exists(target))return null;return target;
}
