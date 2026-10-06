import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExtensionBridge} from '../src/extension-bridge.mjs';
import {extensionAdapter} from '../src/extension-adapter.mjs';

test('官方后端契约：原标签页、旧引用、取消、frame身份及断开保留',async()=>{
  const root=await mkdtemp(join(tmpdir(),'inspire-jev-extension-'));
  const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/frame'?'<label>Frame field<input></label>':'<label>Name<input id="name"></label><iframe src="/frame"></iframe>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  let context,bridge;
  try{
    context=await chromium.launchPersistentContext(root,{headless:true,args:['--remote-debugging-port=0']});
    const page=context.pages()[0];await page.goto(origin);await page.frameLocator('iframe').locator('input').waitFor();
    const [port]= (await readFile(join(root,'DevToolsActivePort'),'utf8')).trim().split('\n');
    bridge=new ExtensionBridge({host:'contract',version:'1.2.0-rc.1'},{cdpEndpoint:`http://127.0.0.1:${port}`});
    const target=await bridge.perform('identity');
    const a=extensionAdapter(bridge,{targetId:target.targetId,sessionId:'contract',allowedOrigins:[origin]});
    const other=extensionAdapter(bridge,{targetId:target.targetId,sessionId:'other',allowedOrigins:[origin]});
    assert.equal(a.identity,other.identity);
    const seen=await a.observe(),field=seen.actions.find(a=>a.kind==='fill');
    await page.locator('#name').evaluate(e=>e.replaceWith(e.cloneNode()));
    assert.equal((await a.validate(field)).reason,'target_replaced');
    const fresh=(await a.observe()).actions.find(a=>a.kind==='fill');
    const controller=new AbortController();controller.abort();
    await assert.rejects(a.execute(fresh,'cancelled',{signal:controller.signal}),e=>e.notIssued);
    assert.equal(await page.locator('#name').inputValue(),'');
    await a.execute(fresh,'confirmed');assert.equal(await page.locator('#name').inputValue(),'confirmed');
    const next=await a.observe();await a.expand(next);const frame=await a.observe();
    const child=frame.actions.find(a=>a.kind==='fill');assert.ok(child.frameId);assert.notEqual(child.frameId,fresh.frameId);
    await a.execute(child,'frame value');assert.equal(await page.frameLocator('iframe').locator('input').inputValue(),'frame value');
    const check=await a.check([{kind:'field',label:'Frame field',equals:'frame value',frameId:child.frameId}]);assert.equal(check.ok,true);
    assert.equal((await a.observe()).frameId,child.frameId);
    await assert.rejects(bridge.perform('identity',{targetId:'wrong-target'}),e=>e.code==='TAB_CHANGED');
    await assert.rejects(bridge.perform('eval',{code:'process.exit()'}),e=>e.code==='INVALID_BRIDGE_OPERATION');
    await bridge.close();bridge=null;assert.equal(page.isClosed(),false);assert.equal(page.url(),origin+'/');assert.equal(context.pages().length,1);
  }finally{await bridge?.close();await context?.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
