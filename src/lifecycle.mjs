import {cp,mkdir,readFile,writeFile,rm,mkdtemp,access,rename,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
const publicFiles=['package.json','npm-shrinkwrap.json','package-lock.json','src','integrations','scripts','skills','plugin.json','mcp.json','.mcp.json','README.md','README.en.md','docs','LICENSE','NOTICE','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md'];
async function sourceDigest(root){
  const hash=createHash('sha256');
  async function add(path){const full=join(root,path);let rows;try{rows=await readdir(full,{withFileTypes:true});}catch(e){if(e.code==='ENOTDIR'){hash.update(path+'\0');hash.update(await readFile(full));return;}if(e.code==='ENOENT')return;throw e;}
    for(const row of rows.sort((a,b)=>a.name.localeCompare(b.name)))await add(join(path,row.name));}
  for(const name of publicFiles)await add(name);return hash.digest('hex');
}
export function entryReleases(record){return Object.fromEntries((record.entries||[]).map(name=>[name,record.entryReleases?.[name]||{release:record.release,version:record.version}]));}
export function updatedInstall(previous,{version,release,done}){
  const byEntry=entryReleases(previous);for(const name of done)byEntry[name]={release,version};
  return{...previous,...(done.length?{version,release,previousVersion:previous.version===version?previous.previousVersion:previous.version}:{}),entries:Object.keys(byEntry),entryReleases:byEntry,updatedAt:new Date().toISOString()};
}
export const piAgentDir=()=>process.env.PI_CODING_AGENT_DIR?resolve(process.env.PI_CODING_AGENT_DIR):join(homedir(),'.pi','agent');
export function localPiSource(item,settingsPath){const source=typeof item==='string'?item:item?.source;if(typeof source!=='string'||/^(?:npm:|git:|https?:|ssh:)/.test(source))return null;return resolve(dirname(settingsPath),source.startsWith('~/')?join(homedir(),source.slice(2)):source);}
async function prepareRelease(root,pkg,config,{downloadBrowser}){
  const release=join(config.home,'releases',pkg.version),digest=await sourceDigest(root);
  if(await exists(release)){
    const info=await readFile(join(release,'release-info.json'),'utf8').then(JSON.parse).catch(()=>null);
    if(!info?.complete||info.sourceHash!==digest)throw Object.assign(Error('该版本已有不同或不完整源码；保留旧目录，请使用新的版本号'),{code:'VERSION_CONFLICT'});
    await access(join(release,'node_modules','playwright','package.json'));
    if(downloadBrowser)runCommand(process.execPath,[join(release,'node_modules','playwright','cli.js'),'install','chromium'],{env:npmEnv(config)});
    return release;
  }
  await secureDirectory(join(config.home,'releases'));const stage=await mkdtemp(join(config.home,'releases','.install-'));await secureDirectory(stage);
  try{
    for(const name of publicFiles)if(await exists(join(root,name)))await cp(join(root,name),join(stage,name),{recursive:true});
    runCommand('npm',['ci','--ignore-scripts','--omit=dev'],{cwd:stage,env:npmEnv(config)});
    if(downloadBrowser)runCommand(process.execPath,[join(stage,'node_modules','playwright','cli.js'),'install','chromium'],{env:npmEnv(config)});
    await atomicJSON(join(stage,'installed-home.json'),{home:config.home});
    await atomicJSON(join(stage,'release-info.json'),{version:pkg.version,sourceHash:digest,complete:true});
    await rename(stage,release);return release;
  }finally{await rm(stage,{recursive:true,force:true});}
}
async function refreshHosts(root,entry,config,{remove=false}={}){
  const cli=join(root,'src','cli.mjs'),name='inspire-jev';
  if(entry==='gpt'){
    if(!await commandAvailable('codex'))throw Object.assign(Error('GPT 插件需要可用的 Codex CLI；Pi 和通用 MCP 可独立安装'),{code:'HOST_NOT_INSTALLED'});
    const marketplace=join(config.home,'marketplaces','inspire-jev-local'),plugin=join(marketplace,'plugins',name);await backup(join(homedir(),'.codex','config.toml'),config.home);
    if(remove){runCommand('codex',['plugin','remove','inspire-jev@inspire-jev-local','--json']);return;}
    await mkdir(join(marketplace,'.agents','plugins'),{recursive:true});await mkdir(plugin,{recursive:true});await cp(join(root,'skills'),join(plugin,'skills'),{recursive:true});await cp(join(root,'plugin.json'),join(plugin,'plugin.json'));
    const manifest={$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{[name]:{type:'stdio',command:process.execPath,args:[cli,'mcp','--host','gpt'],env:{INSPIRE_JEV_HOME:config.home}}}};
    for(const file of ['mcp.json','.mcp.json'])await writeFile(join(plugin,file),JSON.stringify(manifest,null,2)+'\n');
    await writeFile(join(marketplace,'.agents','plugins','marketplace.json'),JSON.stringify({name:'inspire-jev-local',interface:{displayName:'InspireJev'},plugins:[{name,source:{source:'local',path:'./plugins/'+name},policy:{installation:'AVAILABLE',authentication:'ON_USE'},category:'Engineering'}]},null,2)+'\n');
    runCommand('codex',['plugin','marketplace','add',marketplace,'--json']);runCommand('codex',['plugin','add','inspire-jev@inspire-jev-local','--json']);
    const {codexRPC}=await import('../scripts/codex-rpc.mjs');const rpc=await codexRPC();
    try{const result=await rpc.call('config/read',{includeLayers:false});for(const legacy of ['jev-agent@jev-agent-local','jev-browser@jev-local'])if(result.config.plugins?.[legacy]?.enabled)await rpc.call('config/value/write',{keyPath:`plugins."${legacy}".enabled`,value:false,mergeStrategy:'upsert'});}finally{rpc.close();}
  }else if(entry==='pi'){
    if(!await commandAvailable('pi'))throw Object.assign(Error('Pi 未安装；请先安装 Pi，或使用通用 MCP 入口'),{code:'HOST_NOT_INSTALLED'});
    const path=join(piAgentDir(),'settings.json');await backup(path,config.home);let previous=[];
    try{const file=JSON.parse(await readFile(path,'utf8'));for(const item of file.packages||[]){const old=localPiSource(item,path);if(!old||old===root)continue;try{const pkg=JSON.parse(await readFile(join(old,'package.json'),'utf8'));if(['jev-agent','inspire-jev'].includes(pkg.name))previous.push({path:old,item});}catch{}}}catch(e){if(e.code!=='ENOENT')throw e;}
    if(remove){runCommand('pi',['remove',root]);return;}
    runCommand('pi',['install',root]);for(const old of previous)runCommand('pi',['remove',old.path]);
    const filtered=previous.find(old=>typeof old.item==='object');
    if(filtered){const file=JSON.parse(await readFile(path,'utf8'));file.packages=file.packages.map(item=>localPiSource(item,path)===root?{...filtered.item,source:typeof item==='string'?item:item.source}:item);await atomicJSON(path,file);}
  }else{
    const manifest={mcpServers:{[name]:{command:process.execPath,args:[cli,'mcp','--host','mcp'],env:{INSPIRE_JEV_HOME:config.home}}}};if(!remove)await atomicJSON(join(config.home,'mcp-client.json'),manifest);
    if(await commandAvailable('codex')){await backup(join(homedir(),'.codex','config.toml'),config.home);if(remove)runCommand('codex',['mcp','remove','inspire-jev-cli']);else{runCommand('codex',['mcp','add','inspire-jev-cli','--env',`INSPIRE_JEV_HOME=${config.home}`,'--',process.execPath,cli,'mcp','--host','codex-cli']);const list=runCommand('codex',['mcp','list','--json'],{stdio:'pipe'});if(JSON.parse(list.stdout.toString()).some(x=>x.name==='jev-agent-cli'))runCommand('codex',['mcp','remove','jev-agent-cli']);}}
    return manifest;
  }
}
export async function installEntries({entry='all',entrySet,root=packageRoot,downloadBrowser=true}={}){
  if(![...entries,'all'].includes(entry))throw Error('--entry 必须为 gpt、pi、mcp 或 all');
  const config=await settings(),pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(!['inspire-jev','jev-agent'].includes(pkg.name)||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version))throw Error('安装包身份无效');
  const wanted=entrySet??(entry==='all'?entries:[entry]);if(wanted.some(x=>!entries.includes(x)))throw Error('入口集合无效');
  const selected=[];for(const item of wanted){if(item==='mcp'||await commandAvailable(item==='gpt'?'codex':'pi'))selected.push(item);else if(entry!=='all'||entrySet)throw Object.assign(Error(`宿主 ${item} 未安装`),{code:'HOST_NOT_INSTALLED'});}
  const release=await prepareRelease(root,pkg,config,{downloadBrowser});
  const previous=await readInstall(config.home),done=[],failed=[];let mcp;
  for(const item of selected){try{const result=await refreshHosts(release,item,config);if(item==='mcp')mcp=result;done.push(item);}catch(e){failed.push({entry:item,error:e.code||e.name,message:e.message});}}
  const record=updatedInstall(previous,{version:pkg.version,release,done});if(!wanted.length){record.version=pkg.version;record.release=release;record.previousVersion=previous.version;}
  await atomicJSON(join(config.home,'installation.json'),record);if(done.length||!wanted.length)await saveSettings({...config,activeRelease:release});
  const result={...record,installed:done,unavailable:wanted.filter(x=>!selected.includes(x)),failed,mcp,credentialsRetained:true,profilesRetained:true};if(failed.length)throw Object.assign(Error('部分入口安装失败；已完成入口保留，可重复安装'),{code:'PARTIAL_INSTALL',details:result});return result;
}
export async function upgrade(packageInput){
  if(!packageInput)throw Error('upgrade 需要 --package 安装包路径或固定版本 URL');const config=await settings(),stage=await mkdtemp(join(tmpdir(),'inspire-jev-upgrade-'));
  try{runCommand('npm',['install','--prefix',stage,'--ignore-scripts','--no-audit','--no-fund',packageInput],{env:npmEnv(config)});const root=join(stage,'node_modules','inspire-jev');if(!await exists(join(root,'package.json')))throw Error('安装包不是 InspireJev');const previous=await readInstall(config.home);return await installEntries({root,entrySet:previous.entries});}finally{await rm(stage,{recursive:true,force:true});}
}
export async function rollback(version){
  const config=await settings(),previous=await readInstall(config.home);version||=previous.previousVersion;if(!version||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw Error('rollback 需要已安装的 --version');const root=join(config.home,'releases',version);if(!await exists(join(root,'package.json')))throw Error('回退版本不在本机');return installEntries({root,entrySet:previous.entries});
}
export async function uninstall({entry='all'}={}){
  if(![...entries,'all'].includes(entry))throw Error('无效卸载入口');const config=await settings(),record=await readInstall(config.home),selected=entry==='all'?record.entries:[entry],removed=[],failed=[];
  const byEntry=entryReleases(record);for(const item of selected){if(!record.entries.includes(item))continue;try{await refreshHosts(byEntry[item].release,item,config,{remove:true});removed.push(item);delete byEntry[item];}catch(e){failed.push({entry:item,error:e.code||e.name});}}
  const remaining=Object.keys(byEntry);await atomicJSON(join(config.home,'installation.json'),{...record,entries:remaining,entryReleases:byEntry});return{removed,remaining,failed,credentialsRetained:true,profilesRetained:true,releasesRetained:true};
}
export async function dispatchTarget(own){
  if(process.env.INSPIRE_JEV_DISPATCHED)return null;const config=await settings(),target=config.activeRelease&&join(config.activeRelease,'src','cli.mjs');if(!target||resolve(target)===resolve(own)||!inside(join(config.home,'releases'),target)||!await exists(target))return null;return target;
}
