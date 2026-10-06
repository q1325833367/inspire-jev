import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Sessions} from '../src/sessions.mjs';
import {Store} from '../src/storage.mjs';

test('受控浏览器启动不关闭 Chromium 沙箱', {skip:process.platform!=='darwin',timeout:15000}, async()=>{
  const home=await mkdtemp(join(tmpdir(),'jev-sandbox-'));
  const store=await new Store(home,'sandbox-proof').init();
  const sessions=new Sessions({host:'sandbox-proof',version:'test'},store);
  try{
    const info=await sessions.open({profileId:'isolated',allowedOrigins:['https://github.com'],headless:true});
    const profile=join(store.root,'profiles','isolated');
    const {stdout}=await promisify(execFile)('/bin/ps',['-axo','command']);
    const browser=stdout.split('\n').find(line=>line.includes(`--user-data-dir=${profile}`)&&line.includes('--remote-debugging-pipe'));
    assert.ok(browser,'必须检查实际启动的浏览器进程');
    assert.doesNotMatch(browser,/(?:^|\s)--(?:no-sandbox|disable-setuid-sandbox)(?:\s|$)/);
    assert.equal(await sessions.get(info.id).page.title(),'');
  }finally{await sessions.closeAll();await rm(home,{recursive:true,force:true});}
});
