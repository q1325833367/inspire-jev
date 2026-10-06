#!/usr/bin/env node
import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {settings,VERSION,defaultHome} from './config.mjs';
import {startMCP} from './mcp.mjs';
import {Store,atomicJSON} from './storage.mjs';
import {loadConfig,createServices} from './providers.mjs';
import {ProxyAgent,fetch} from 'undici';
import {inspectLock,recoverLock} from './locks.mjs';

const argv=process.argv.slice(2),command=argv.shift()||'help';
const flag=name=>{const i=argv.indexOf(`--${name}`);return i<0?undefined:argv[i+1];};
const out=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
try{
  if(command==='mcp'){
    const runtime=await startMCP({host:flag('host')||'mcp',...(argv.includes('--trace')?{trace:true}:{})});
    let closing=false;const close=async()=>{if(closing)return;closing=true;try{await runtime.shutdown();process.exitCode=0;}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}};
    process.on('SIGINT',close);process.on('SIGTERM',close);process.stdin.on('end',close);
  }else if(command==='setup'){
    const home=defaultHome(),envFile=flag('env-file');if(!envFile)throw Error('setup 需要 --env-file 本地私密配置文件');
    await loadConfig(resolve(envFile));await mkdir(home,{recursive:true,mode:0o700});
    const old=await settings();const config={envFile:resolve(envFile),modelProxy:flag('model-proxy')??old.modelProxy,browserProxy:flag('browser-proxy')??old.browserProxy,trace:false};
    await atomicJSON(join(home,'config.json'),config);out({configured:true,home,trace:false,credentials:'仅引用现有私密文件'});
  }else if(command==='doctor'){
    const c=await settings(),checks={node:process.version,requiredNode:24,home:c.home,modelsConfigured:false,modelProxy:c.modelProxy,browserProxy:c.browserProxy,trace:c.trace};
    try{const s=await stat(c.envFile);await loadConfig(c.envFile);checks.modelsConfigured=true;checks.credentialsMode=(s.mode&0o777).toString(8);}catch{checks.credentialsError='私密配置不可读或缺项';}
    for(const [key,url,proxy] of [['modelNetwork','https://api.typesafe.ai',c.modelProxy],['websiteNetwork','https://www.gutenberg.org/',c.browserProxy]]){
      const dispatcher=proxy?new ProxyAgent(proxy):undefined,began=performance.now();try{const r=await fetch(url,{dispatcher,signal:AbortSignal.timeout(8000)});checks[key]={reachable:true,http:r.status,proxy:proxy||'直连',ms:Math.round(performance.now()-began)};await r.body?.cancel();}catch(e){checks[key]={reachable:false,error:e.cause?.code||e.name,proxy:proxy||'直连',ms:Math.round(performance.now()-began)};}finally{await dispatcher?.close();}
    }
    if(argv.includes('--models')&&checks.modelsConfigured){const s=createServices(await loadConfig(c.envFile),{proxy:c.modelProxy});try{try{checks.jev=await s.decide({page:{url:'https://www.gutenberg.org/',title:'诊断',text:'诊断网页',actions:[{id:'e1',kind:'click',label:'搜索'}]},step:{id:'diagnostic',goal:'点击搜索'},recent:[]},AbortSignal.timeout(8000));}catch(e){checks.jev={error:e.code||e.name,message:e.message};process.exitCode=1;}try{const t=await s.generate({instruction:'为自动化浏览器执行工具生成新的中文用途描述，二十字以内，不是读取现成字段值',field:{label:'用途描述'},text:'Jev Agent 帮助智能体连续执行网页交互。'},AbortSignal.timeout(8000));checks.text={model:t.model,latency_ms:t.latency_ms,usage:t.usage,generated:true};}catch(e){checks.text={error:e.code||e.name,message:e.message};process.exitCode=1;}}finally{await s.close();}}
    if(!checks.modelsConfigured||!checks.modelNetwork.reachable||!checks.websiteNetwork.reachable)process.exitCode=1;
    out({version:VERSION,checks,tunOffVerified:false,note:'网络可达检查不等于已证明 TUN 关闭；正式验收需记录系统现场。'});
  }else if(command==='cleanup'){
    const c=await settings(),host=flag('host')||'mcp',store=await new Store(c.home,host).init();out(await store.cleanup({dryRun:!argv.includes('--apply')}));
  }else if(command==='lock'){
    const identity=flag('identity');if(!identity)throw Error('需要 --identity 真实会话身份');out(argv.includes('--recover')?await recoverLock(identity,{inspected:argv.includes('--inspected')}):await inspectLock(identity));
  }else if(command==='version')out({version:VERSION});
  else out({version:VERSION,commands:['setup --env-file 路径 --model-proxy 地址 --browser-proxy 地址','doctor [--models]','mcp --host gpt|pi|codex-cli|mcp','cleanup --host 宿主 [--apply]','lock --identity 身份 [--recover --inspected]']});
}catch(e){process.stderr.write(JSON.stringify({error:e.code||e.name,message:e.message})+'\n');process.exitCode=1;}
