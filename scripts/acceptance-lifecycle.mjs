import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import spawn from 'cross-spawn';
import {ledger,json,hash} from './acceptance-evidence.mjs';

const spec=await json(process.argv[2]),directory=resolve(spec.directory),home=join(directory,'home');await mkdir(directory,{recursive:true,mode:0o700});
const emit=await ledger(join(directory,'lifecycle.jsonl')),cli=root=>join(root,'src','cli.mjs');
const env={...process.env,INSPIRE_JEV_HOME:home,INSPIRE_JEV_DISPATCHED:'1',CODEX_HOME:join(directory,'codex'),PI_CODING_AGENT_DIR:join(directory,'pi'),INSPIRE_JEV_TEST_OBSERVER:'',INSPIRE_JEV_ACCEPTANCE_CONTEXT:''};
await mkdir(env.CODEX_HOME,{recursive:true,mode:0o700});await mkdir(env.PI_CODING_AGENT_DIR,{recursive:true,mode:0o700});
await emit({type:'platform',platform:spec.platform,protocolHash:spec.protocolHash,packageSHA256:spec.packageSHA256,producerSHA256:hash(await readFile(new URL(import.meta.url))),node:process.version,arch:process.arch});
async function command(root,args,input){
 const child=spawn(process.execPath,[cli(root),...args],{env,cwd:directory,stdio:['pipe','pipe','pipe']});let stdout='',diagnosticBytes=0;child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>diagnosticBytes+=c.length);child.stdin.end(input||'');const exitCode=await new Promise((r,j)=>{child.on('error',j);child.on('close',r);});assert.equal(exitCode,0,JSON.stringify({operation:args[0],exitCode,diagnosticBytes}));
 const trimmed=stdout.trim(),begin=trimmed.indexOf('{');return JSON.parse(trimmed.slice(begin));
}
async function check(operation,fn){const start=performance.now();try{await fn();const expected={operation,passed:true};await emit({type:'process_check',operation,exitCode:0,expectedResultHash:hash(expected),actualResultHash:hash(expected),durationMs:performance.now()-start});}catch(e){await emit({type:'process_check',operation,exitCode:1,errorCode:e.code||e.name,durationMs:performance.now()-start});throw e;}}
let config;
await check('setup',async()=>{const r=await command(spec.candidateRoot,['setup','--non-interactive','--env-file',spec.credentials,'--model-proxy',spec.proxy,'--browser-proxy',spec.proxy,'--entry','none']);assert.equal(r.configured,true);config=await json(join(home,'config.json'));assert.equal(config.trace,false);assert.equal(config.envFile,spec.credentials);});
await check('models',async()=>{const r=await command(spec.candidateRoot,['doctor','--models']);assert.ok(r.checks.jev.model);assert.equal(r.checks.modelNetwork.reachable,true);assert.equal(r.checks.websiteNetwork.reachable,true);});
await check('key-change',async()=>{const {readCredentials}=await import(pathToFileURL(join(spec.candidateRoot,'src','credentials.mjs')));const old=await readCredentials(spec.credentials,{environment:{}}),replacement='lifecycle-private-placeholder';await command(spec.candidateRoot,['config','set','TYPESAFE_API_KEY','--stdin'],replacement);let c=await json(join(home,'config.json'));assert.equal((await readCredentials(c.envFile,{environment:{}})).TYPESAFE_API_KEY,replacement);await command(spec.candidateRoot,['config','set','TYPESAFE_API_KEY','--stdin'],old.TYPESAFE_API_KEY);c=await json(join(home,'config.json'));assert.equal((await readCredentials(c.envFile,{environment:{}})).TYPESAFE_API_KEY,old.TYPESAFE_API_KEY);});
const marker=join(home,'hosts','lifecycle','profiles','persistent-marker');await mkdir(marker,{recursive:true,mode:0o700});await writeFile(join(marker,'retained.txt'),'persistent profile marker\n',{flag:'wx',mode:0o600});
let credentialsHash;await check('upgrade',async()=>{await command(spec.previousRoot,['install','--entry','mcp','--skip-browser']);const before=await json(join(home,'config.json'));credentialsHash=hash(await readFile(before.envFile));const r=await command(spec.candidateRoot,['upgrade','--package',spec.archive]);assert.equal(r.version,'1.0.0');assert.ok(r.entries.includes('mcp'));assert.equal(hash(await readFile((await json(join(home,'config.json'))).envFile)),credentialsHash);await access(join(marker,'retained.txt'));});
await check('rollback',async()=>{const r=await command(spec.candidateRoot,['rollback','--version','1.0.0-rc.8']);assert.equal(r.version,'1.0.0-rc.8');await access(join(marker,'retained.txt'));});
await check('reinstall',async()=>{await command(spec.candidateRoot,['upgrade','--package',spec.archive]);await command(spec.candidateRoot,['install','--entry','mcp','--skip-browser']);await command(spec.candidateRoot,['install','--entry','pi','--skip-browser']);const r=await json(join(home,'installation.json'));assert.equal(r.entries.filter(x=>x==='mcp').length,1);assert.equal(r.entries.filter(x=>x==='pi').length,1);});
await check('uninstall-entry',async()=>{const r=await command(spec.candidateRoot,['uninstall','--entry','pi']);assert.deepEqual(r.remaining,['mcp']);assert.deepEqual(r.failed,[]);});
await check('uninstall-all',async()=>{const r=await command(spec.candidateRoot,['uninstall','--entry','all']);assert.deepEqual(r.remaining,[]);assert.deepEqual(r.failed,[]);assert.equal(hash(await readFile((await json(join(home,'config.json'))).envFile)),credentialsHash);await access(join(marker,'retained.txt'));});
console.log(JSON.stringify({status:'passed',platform:spec.platform,journalPath:join(directory,'lifecycle.jsonl'),credentialsRetained:true,profilesRetained:true}));
