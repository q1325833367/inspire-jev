#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {settings,VERSION} from './config.mjs';
import {startMCP} from './mcp.mjs';
import {Store} from './storage.mjs';
import {createServices} from './providers.mjs';
import {readCredentials,publicCredentials} from './credentials.mjs';
import {configure,configCommand} from './setup.mjs';
import {installEntries,upgrade,rollback,uninstall,dispatchTarget} from './lifecycle.mjs';
import {ProxyAgent,fetch} from 'undici';
import {inspectLock,recoverLock} from './locks.mjs';
const argv=process.argv.slice(2),command=argv.shift()||'help';
const flag=name=>{const i=argv.indexOf(`--${name}`);return i<0?undefined:argv[i+1];};
const out=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
try{
 const target=!['install','upgrade','rollback'].includes(command)&&await dispatchTarget(fileURLToPath(import.meta.url));
 if(target){const child=spawn(process.execPath,[target,command,...argv],{stdio:'inherit',env:{...process.env,INSPIRE_JEV_DISPATCHED:'1'}});for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>child.kill(s));await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{process.exitCode=code??1;resolve();});});}
 else if(command==='mcp'){
  const runtime=await startMCP({host:flag('host')||'mcp',...(argv.includes('--trace')?{trace:true}:{})});
  let closing=false;const close=async()=>{if(closing)return;closing=true;try{await runtime.shutdown();process.exitCode=0;}catch(e){process.stderr.write(JSON.stringify({error:e.code||e.name,message:e.message})+'\n');process.exitCode=1;}};
  process.on('SIGINT',close);process.on('SIGTERM',close);process.stdin.on('end',close);
 }else if(command==='setup'){
  const configured=await configure({envFile:flag('env-file'),modelProxy:flag('model-proxy'),browserProxy:flag('browser-proxy'),entry:flag('entry'),nonInteractive:argv.includes('--non-interactive')});
  const installed=configured.entry&&configured.entry!=='none'?await installEntries({entry:configured.entry}):undefined;
  out({configured:true,home:configured.config.home,trace:false,models:publicCredentials(await readCredentials(configured.config.envFile,{requireKey:false})),installed});
 }else if(command==='config')out(await configCommand(argv[0]||'show',argv[1],{stdin:argv.includes('--stdin')}));
 else if(command==='linux-sandbox-profile')process.stdout.write(await(await import('../scripts/linux-sandbox.mjs')).linuxSandboxProfile());
 else if(command==='install')out(await installEntries({entry:flag('entry')||'all',downloadBrowser:!argv.includes('--skip-browser')}));
 else if(command==='upgrade')out(await upgrade(flag('package')));
 else if(command==='rollback')out(await rollback(flag('version')));
 else if(command==='uninstall')out(await uninstall({entry:flag('entry')||'all'}));
 else if(command==='doctor'){
  const c=await settings(),values=await readCredentials(c.envFile,{requireKey:false}),checks={node:process.version,requiredNode:24,platform:process.platform,architecture:process.arch,home:c.home,models:publicCredentials(values),modelProxy:c.modelProxy,browserProxy:c.browserProxy,trace:c.trace};
  if(!values.TYPESAFE_API_KEY){checks.configurationError='缺少 TypeSafe key';process.exitCode=1;}
  for(const [key,url,proxy]of [['modelNetwork',new URL(values.TYPESAFE_BASE_URL).origin,c.modelProxy],['websiteNetwork','https://www.gutenberg.org/',c.browserProxy]]){
   const dispatcher=proxy?new ProxyAgent(proxy):undefined,began=performance.now();try{const r=await fetch(url,{dispatcher,signal:AbortSignal.timeout(8000)});checks[key]={reachable:true,http:r.status,proxy:proxy||'直连',ms:Math.round(performance.now()-began)};await r.body?.cancel();}catch(e){checks[key]={reachable:false,error:e.cause?.code||e.name,proxy:proxy||'直连',ms:Math.round(performance.now()-began)};process.exitCode=1;}finally{await dispatcher?.close();}
  }
  if(argv.includes('--models')&&values.TYPESAFE_API_KEY){const s=createServices(values,{proxy:c.modelProxy});try{
   try{const r=await s.decide({page:{url:'https://www.gutenberg.org/',title:'诊断',text:'诊断网页',actions:[{id:'e1',kind:'click',label:'搜索'}]},step:{id:'diagnostic',goal:'点击搜索'},recent:[]},AbortSignal.timeout(8000));checks.jev={model:r.model,latency_ms:r.latency_ms,usage:r.usage};}catch(e){checks.jev={error:e.code||e.name,message:e.message};process.exitCode=1;}
   if(values.TEXT_MODEL_API_KEY)try{const t=await s.generate({instruction:'为浏览器执行工具生成二十字以内的新中文用途描述',field:{label:'用途描述'},text:'InspireJev 连续执行网页交互'},AbortSignal.timeout(8000));checks.text={model:t.model,latency_ms:t.latency_ms,usage:t.usage};}catch(e){checks.text={error:e.code||e.name,message:e.message};process.exitCode=1;}
  }finally{await s.close();}}
  out({version:VERSION,checks});
 }else if(command==='cleanup'){
  const c=await settings(),store=await new Store(c.home,flag('host')||'mcp').init();out(await store.cleanup({dryRun:!argv.includes('--apply')}));
 }else if(command==='lock'){
  const identity=flag('identity');if(!identity)throw Error('需要 --identity 真实会话身份');out(argv.includes('--recover')?await recoverLock(identity,{inspected:argv.includes('--inspected')}):await inspectLock(identity));
 }else if(command==='version')out({version:VERSION});
 else out({name:'InspireJev',version:VERSION,commands:['setup [--env-file 路径] [--entry gpt|pi|mcp|all]','install --entry gpt|pi|mcp|all','config show|set 名称|unset 名称','doctor [--models]','mcp --host gpt|pi|codex-cli|mcp','upgrade --package 路径或固定版本URL','rollback --version 版本','uninstall --entry gpt|pi|mcp|all','cleanup --host 宿主 [--apply]','lock --identity 身份 [--recover --inspected]']});
}catch(e){process.stderr.write(JSON.stringify({error:e.code||e.name,message:e.message,...(e.details?{details:e.details}:{})})+'\n');process.exitCode=1;}
