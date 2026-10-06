import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {ledger} from './acceptance-evidence.mjs';

export function defaultRouteInterface(){
 if(process.platform==='darwin')return execFileSync('/sbin/route',['-n','get','default'],{encoding:'utf8'}).match(/interface:\s*(\S+)/)?.[1];
 if(process.platform==='win32')return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$r=Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1;@{name=$r.InterfaceAlias;index=$r.InterfaceIndex}|ConvertTo-Json -Compress"],{encoding:'utf8'})).name;
 return null;
}
export async function collectNetwork(agent,directory){
 const emit=await ledger(join(directory,'network.jsonl'));let route=defaultRouteInterface();
 if(process.platform==='linux')route=(await readFile('/proc/net/route','utf8')).split('\n').slice(1).map(s=>s.split(/\s+/)).find(r=>r[1]==='00000000')?.[0];
 if(!route||/tun|tap|vpn|clash|meta/i.test(route))throw Error('默认网络路径尚未证实为无 TUN');
 const session=await agent.call('jev_session',{action:'open',url:'https://www.gutenberg.org/',allowedOrigins:['https://www.gutenberg.org'],headless:true});
 try{
  const page=agent.sessions.get(session.id).page;if(new URL(page.url()).origin!=='https://www.gutenberg.org')throw Error('公开网站代理观测失败');
  const services=await agent.services();let model;
  try{model=await services.decide({page:{url:page.url(),title:'network preflight',text:'Read-only connection diagnostic',actions:[{id:'diagnostic',kind:'click',label:'Read-only diagnostic candidate'}]},step:{id:'network',goal:'Select the diagnostic candidate; nothing will execute.'},recent:[]},AbortSignal.timeout(30000));}finally{await services.close?.();agent.serviceSets.delete(services);}
  if(!model.model)throw Error('模型接口未返回实际版本');
  return await emit({type:'network',platform:process.platform,arch:process.arch,defaultRouteInterface:route,configuredInterfaces:Object.keys(networkInterfaces()),modelProxy:agent.config.modelProxy||'direct',browserProxy:agent.config.browserProxy||'direct',observedPublicOrigin:new URL(page.url()).origin,model:model.model,usage:model.usage,modelLatencyMs:model.latency_ms});
 }finally{await agent.call('jev_session',{action:'close',sessionId:session.id});}
}
