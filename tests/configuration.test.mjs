import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readCredentials,writeCredentials,publicCredentials} from '../src/credentials.mjs';
import {userDataHome,processIdentity} from '../src/platform.mjs';
import {acquire,inspectLock,recoverLock} from '../src/locks.mjs';
import {updatedInstall,localPiSource,piAgentDir} from '../src/lifecycle.mjs';

test('新安装使用平台标准目录，并兼容两个 home 环境变量',()=>{
  assert.equal(userDataHome({platform:'darwin',home:'/test',env:{}}),join('/test','Library','Application Support','InspireJev'));
  assert.equal(userDataHome({platform:'linux',home:'/test',env:{XDG_DATA_HOME:'/data'}}),join('/data','inspire-jev'));
  assert.equal(userDataHome({platform:'win32',home:'/test',env:{LOCALAPPDATA:'/appdata'}}),join('/appdata','InspireJev'));
  assert.equal(userDataHome({env:{INSPIRE_JEV_HOME:'/new',JEV_AGENT_HOME:'/old'}}),'/new');
  assert.equal(userDataHome({env:{JEV_AGENT_HOME:'/old'}}),'/old');
});
test('私密文件支持标准 env 引号，环境变量优先，文本模型可缺省',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'inspire-config-'));
  try{const path=join(dir,'private.env');await writeFile(path,'TYPESAFE_API_KEY="file-credential"\nTYPESAFE_MODEL=jev-pinned\n');
    const values=await readCredentials(path,{environment:{TYPESAFE_API_KEY:'environment-credential'}});
    assert.equal(values.TYPESAFE_API_KEY,'environment-credential');assert.equal(values.TYPESAFE_MODEL,'jev-pinned');assert.equal(values.TEXT_MODEL_API_KEY,undefined);
    assert.equal(publicCredentials(values).TYPESAFE_API_KEY,'已配置');assert.ok(!JSON.stringify(publicCredentials(values)).includes('environment-credential'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('凭据原子保存到私密目录；无效模型地址不会通过验证',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'inspire-credentials-'));
  try{const path=await writeCredentials(dir,{TYPESAFE_API_KEY:'test-credential#=value',TEXT_MODEL:'custom-text'});
    const values=await readCredentials(path,{environment:{}});assert.equal(values.TYPESAFE_API_KEY,'test-credential#=value');assert.equal(values.TEXT_MODEL,'custom-text');
    if(process.platform!=='win32'){assert.equal((await stat(path)).mode&0o777,0o600);assert.equal((await stat(dir)).mode&0o777,0o700);}
    await assert.rejects(readCredentials(undefined,{environment:{TYPESAFE_API_KEY:'test',TYPESAFE_BASE_URL:'https://secret:password@example.com'}}),/不含凭据/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('配置 CLI 可从 stdin 更新 key，输出与 config.json 不含值',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'inspire-cli-')),env={...process.env,INSPIRE_JEV_HOME:dir};
  try{const cli=resolve('src/cli.mjs'),secret='private-fixture-credential';
    const updated=spawnSync(process.execPath,[cli,'config','set','TYPESAFE_API_KEY','--stdin'],{env,input:secret,encoding:'utf8'});assert.equal(updated.status,0,updated.stderr);assert.ok(!updated.stdout.includes(secret));
    const shown=spawnSync(process.execPath,[cli,'config','show'],{env,encoding:'utf8'});assert.equal(shown.status,0,shown.stderr);assert.ok(!shown.stdout.includes(secret));assert.equal(JSON.parse(shown.stdout).models.TYPESAFE_API_KEY,'已配置');
    assert.ok(!(await readFile(join(dir,'config.json'),'utf8')).includes(secret));
    const before=await readFile(join(dir,'config.json'),'utf8');const bad=spawnSync(process.execPath,[cli,'config','set','modelProxy','--stdin'],{env,input:'https://name:password@example.com',encoding:'utf8'});assert.equal(bad.status,1);assert.equal(await readFile(join(dir,'config.json'),'utf8'),before);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('真实进程身份可核验；仍存活的锁禁止回收',async()=>{
  const identity='portable-lock-'+process.pid+'-'+Date.now();assert.ok(await processIdentity(process.pid));
  const release=await acquire(identity,'test');
  try{assert.equal((await inspectLock(identity)).ownerAlive,true);await assert.rejects(recoverLock(identity,{inspected:true}),/仍存活/);}finally{await release();}
});
test('凭据中的反斜线、引号与注释字符可以无损保存',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'inspire-roundtrip-'));
  try{for(const value of ['value\\part','value"part',"value'part#tag",'both\'"#value']){const path=await writeCredentials(dir,{TYPESAFE_API_KEY:value});assert.equal((await readCredentials(path,{environment:{}})).TYPESAFE_API_KEY,value);}}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('部分安装只更新成功入口，完全失败保留原版本和路径',()=>{
 const old={version:'1.0.0-rc.3',release:'/releases/old',entries:['gpt','pi']};
 const partial=updatedInstall(old,{version:'1.0.0-rc.4',release:'/releases/new',done:['gpt']});
 assert.equal(partial.entryReleases.gpt.release,'/releases/new');assert.equal(partial.entryReleases.pi.release,'/releases/old');assert.deepEqual(partial.entries,['gpt','pi']);
 const failed=updatedInstall(old,{version:'1.0.0-rc.4',release:'/releases/new',done:[]});assert.equal(failed.release,old.release);assert.equal(failed.version,old.version);assert.deepEqual(failed.entries,old.entries);
});
test('Pi 原生目录和对象形式包配置均保留本地来源语义',()=>{
 const path=join('/test','pi-agent','settings.json');assert.equal(localPiSource({source:'../packages/inspire',extensions:['selected.ts']},path),resolve('/test/packages/inspire'));assert.equal(localPiSource('npm:example',path),null);
 const previous=process.env.PI_CODING_AGENT_DIR;try{process.env.PI_CODING_AGENT_DIR=resolve('/test/pi-native');assert.equal(piAgentDir(),resolve('/test/pi-native'));}finally{if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;}
});

test('旧 RC.8 安装指纹可供回退使用，源码变化仍拒绝覆盖',async()=>{
 const {mkdir}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{installEntries}=await import('../src/lifecycle.mjs');
 const home=await mkdtemp(join(tmpdir(),'inspire-legacy-')),root=join(home,'releases','1.0.0-rc.8'),previous=process.env.INSPIRE_JEV_HOME;
 try{process.env.INSPIRE_JEV_HOME=home;await mkdir(join(root,'src'),{recursive:true});await mkdir(join(root,'node_modules','playwright'),{recursive:true});
  const files=[['package.json',JSON.stringify({name:'inspire-jev',version:'1.0.0-rc.8'})],[join('src','marker.mjs'),'export const marker=1;']];const legacy=createHash('sha256');for(const[path,value]of files){await writeFile(join(root,path),value);legacy.update(path+'\0');legacy.update(value);}
  await writeFile(join(root,'node_modules','playwright','package.json'),'{}');await writeFile(join(root,'release-info.json'),JSON.stringify({complete:true,sourceHash:legacy.digest('hex')}));
  const r=await installEntries({entrySet:[],root,downloadBrowser:false});assert.equal(r.version,'1.0.0-rc.8');await writeFile(join(root,'src','marker.mjs'),'export const marker=2;');await assert.rejects(installEntries({entrySet:[],root,downloadBrowser:false}),{code:'VERSION_CONFLICT'});
 }finally{if(previous===undefined)delete process.env.INSPIRE_JEV_HOME;else process.env.INSPIRE_JEV_HOME=previous;await rm(home,{recursive:true,force:true});}
});
