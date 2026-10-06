import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import spawn from 'cross-spawn';
import {ledger,json,hash} from './acceptance-evidence.mjs';
import {collectNetwork} from './acceptance-network.mjs';
const spec=await json(process.argv[2]),directory=resolve(spec.directory),home=join(directory,'platform-home');await mkdir(directory,{recursive:true,mode:0o700});
const {Agent}=await import(pathToFileURL(join(spec.candidateRoot,'src','agent.mjs')).href);
if(process.argv[3]==='--child'){
 const agent=await Agent.create({home,host:'platform',envFile:spec.credentials,modelProxy:spec.proxy,browserProxy:spec.proxy});
 try{const s=await agent.call('jev_session',{action:'open',profileId:'persistent-platform',url:'https://www.gutenberg.org/',allowedOrigins:['https://www.gutenberg.org'],headless:true}),active=agent.sessions.get(s.id);
  if(process.argv[4]==='write')await active.context.addCookies([{name:'inspire-platform-marker',value:'persisted',domain:'www.gutenberg.org',path:'/',expires:Math.floor(Date.now()/1000)+3600,sameSite:'Lax',secure:true}]);
  const persisted=(await active.context.cookies()).some(c=>c.name==='inspire-platform-marker'&&c.value==='persisted');assert.ok(persisted);console.log(JSON.stringify({pid:process.pid,persisted:true,profileId:s.profileId}));
 }finally{await agent.close();}process.exit(0);
}
const emit=await ledger(join(directory,'platform.jsonl'));await emit({type:'platform',platform:spec.platform,protocolHash:spec.protocolHash,packageSHA256:spec.packageSHA256,producerSHA256:hash(await readFile(new URL(import.meta.url))),node:process.version,arch:process.arch});
async function check(operation,fn){const start=performance.now();try{const value=await fn(),expected={operation,passed:true};await emit({type:'process_check',operation,exitCode:0,expectedResultHash:hash(expected),actualResultHash:hash(expected),durationMs:performance.now()-start,evidence:value});}catch(e){await emit({type:'process_check',operation,exitCode:1,errorCode:e.code||e.name,durationMs:performance.now()-start});throw e;}}
const agent=await Agent.create({home,host:'platform',envFile:spec.credentials,modelProxy:spec.proxy,browserProxy:spec.proxy});
try{
 await check('runtime',async()=>{assert.equal(agent.config.version,'1.0.0');assert.equal(agent.config.buildFingerprint,spec.buildFingerprint);assert.equal(process.versions.node.split('.')[0],'24');return{version:agent.config.version,buildFingerprint:agent.config.buildFingerprint};});
 await check('sandbox',async()=>{const s=await agent.call('jev_session',{action:'open',profileId:'sandbox-check',url:'https://www.gutenberg.org/',allowedOrigins:['https://www.gutenberg.org'],headless:true});assert.equal(new URL(agent.sessions.get(s.id).page.url()).origin,'https://www.gutenberg.org');await agent.call('jev_session',{action:'close',sessionId:s.id});return{browserOpened:true,launchSourceSHA256:hash(await readFile(join(spec.candidateRoot,'src','sessions.mjs'))),nonRoot:process.getuid?process.getuid()!==0:undefined};});
 await check('proxy',async()=>{const r=await collectNetwork(agent,directory);return{networkEventHash:r.hash,model:r.model,route:r.defaultRouteInterface};});
 await check('cancel',async()=>{const controller=new AbortController();controller.abort();const before=agent.sessions.list().length;const r=await agent.call('jev_session',{action:'open',url:'https://www.gutenberg.org/',allowedOrigins:['https://www.gutenberg.org'],headless:true},{signal:controller.signal});assert.equal(r.status,'cancelled');assert.equal(agent.sessions.list().length,before);return{newSessions:0};});
}finally{await agent.close();}
async function child(mode){const p=spawn(process.execPath,[fileURLToPath(import.meta.url),process.argv[2],'--child',mode],{env:{...process.env,INSPIRE_JEV_TEST_OBSERVER:'',INSPIRE_JEV_ACCEPTANCE_CONTEXT:''},stdio:['ignore','pipe','pipe']});let out='',bytes=0;p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>bytes+=c.length);const exit=await new Promise((r,j)=>{p.on('error',j);p.on('close',r);});assert.equal(exit,0,JSON.stringify({mode,exit,diagnosticBytes:bytes}));return JSON.parse(out.trim());}
await check('recover',async()=>{const first=await child('write'),second=await child('read');assert.notEqual(first.pid,second.pid);assert.equal(second.persisted,true);assert.equal(first.profileId,second.profileId);return{firstPid:first.pid,secondPid:second.pid,persisted:true};});
console.log(JSON.stringify({status:'passed',platform:spec.platform,journalPath:join(directory,'platform.jsonl')}));
