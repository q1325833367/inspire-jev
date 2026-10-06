import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Agent} from '../src/agent.mjs';

async function fixture(work){
  const home=await mkdtemp(join(tmpdir(),'inspire-profile-'));
  const server=createServer((req,res)=>{
    if(req.url==='/login')res.setHeader('Set-Cookie','session=fixture-account; HttpOnly; SameSite=Lax; Max-Age=86400; Path=/');
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<h1>${req.url==='/login'||req.headers.cookie?.includes('session=fixture-account')?'已登录':'未登录'}</h1>`);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  try{await work(home,origin);}finally{await new Promise(r=>server.close(r));await rm(home,{recursive:true,force:true});}
}
const open=(agent,origin,options={})=>agent.call('jev_session',{action:'open',url:origin,allowedOrigins:[origin],headless:true,...options});
const heading=(agent,id)=>agent.sessions.get(id).page.locator('h1').textContent();

test('新任务和进程重启复用默认档案，宿主之间不共享登录态',async()=>fixture(async(home,origin)=>{
  let agent=await Agent.create({home,host:'owner',browserProxy:null,modelProxy:null});
  try{
    const first=await open(agent,origin,{url:origin+'/login'});assert.equal(await heading(agent,first.id),'已登录');await agent.close();
    agent=await Agent.create({home,host:'owner',browserProxy:null,modelProxy:null});const next=await open(agent,origin);
    assert.notEqual(next.id,first.id);assert.equal(next.profileId,first.profileId);assert.equal(await heading(agent,next.id),'已登录');
    await assert.rejects(open(agent,origin),e=>e.code==='TAB_BUSY');await agent.close();
    agent=await Agent.create({home,host:'another-host',browserProxy:null,modelProxy:null});const separate=await open(agent,origin);assert.equal(await heading(agent,separate.id),'未登录');
  }finally{await agent.close();}
}));

test('选择已有档案后新会话默认复用，旧会话恢复仍使用原档案',async()=>fixture(async(home,origin)=>{
  let agent=await Agent.create({home,host:'owner',browserProxy:null,modelProxy:null});
  try{
    const old=await open(agent,origin,{profileId:'legacy-account',url:origin+'/login'});await agent.call('jev_session',{action:'close',sessionId:old.id});
    const blank=await open(agent,origin,{profileId:'explicit-isolated'});assert.equal(await heading(agent,blank.id),'未登录');await agent.call('jev_session',{action:'close',sessionId:blank.id});
    await assert.rejects(agent.call('jev_session',{action:'useProfile',profileId:'missing'}),e=>e.code==='PROFILE_NOT_FOUND');
    await assert.rejects(agent.call('jev_session',{action:'useProfile',profileId:'../another-host'}),/无效编号/);
    await agent.call('jev_session',{action:'useProfile',profileId:old.profileId});await agent.close();
    agent=await Agent.create({home,host:'owner',browserProxy:null,modelProxy:null});const selected=await open(agent,origin);assert.equal(selected.profileId,old.profileId);assert.equal(await heading(agent,selected.id),'已登录');
    const listed=await agent.call('jev_session',{action:'profiles'});assert.equal(listed.defaultProfileId,old.profileId);assert.equal(listed.profiles.find(p=>p.isDefault).openSessionIds[0],selected.id);assert.ok(!JSON.stringify(listed).includes('fixture-account'));await agent.call('jev_session',{action:'close',sessionId:selected.id});
    const restored=await open(agent,origin,{sessionId:blank.id});assert.equal(restored.profileId,blank.profileId);assert.equal(await heading(agent,restored.id),'未登录');await agent.call('jev_session',{action:'close',sessionId:restored.id});
    await rm(join(agent.store.root,'profiles',old.profileId),{recursive:true});assert.equal((await agent.call('jev_session',{action:'profiles'})).defaultError,'PROFILE_NOT_FOUND');
    await assert.rejects(open(agent,origin),e=>e.code==='PROFILE_NOT_FOUND');
    await agent.call('jev_session',{action:'useProfile',profileId:blank.profileId});assert.equal((await open(agent,origin)).profileId,blank.profileId);
  }finally{await agent.close();}
}));
