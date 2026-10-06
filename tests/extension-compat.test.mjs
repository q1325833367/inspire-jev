import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {patchExtensionProtocol} from '../src/extension-compat.mjs';
import {publicBrowserMetadata,ExtensionBridge} from '../src/extension-bridge.mjs';
import {navigationEffectMatches} from '../src/extension-adapter.mjs';

test('扩展身份兼容补丁只读取已授权标签页，拒绝其他命令与版本变化',async()=>{
  const require=createRequire(import.meta.url),backend=createRequire(require.resolve('@playwright/mcp/package.json'));
  const original=await readFile(join(dirname(backend.resolve('playwright-core/package.json')),'lib/coreBundle.js'),'utf8');
  const patched=patchExtensionProtocol(original);
  assert.throws(()=>patchExtensionProtocol(original+'\n'),/版本指纹/);
  const start=patched.indexOf('      async handleCDPCommand(method, params2, sessionId) {');
  const end=patched.indexOf('      async forwardToExtension(',start);
  const handler=runInNewContext('({'+patched.slice(start,end)+'})',{crypto:webcrypto});
  const targetInfo={targetId:'physical-target'},tab={sessionId:'authorized-tab',targetInfo};
  handler._model={_findTabSession:predicate=>predicate(tab)?tab:undefined,getTargetInfo:id=>id===tab.sessionId?targetInfo:undefined};
  const browser=(await handler.handleCDPCommand('Target.attachToBrowserTarget')).result.sessionId;
  await assert.rejects(handler.handleCDPCommand('Target.attachToTarget',{targetId:'outside'},browser),/unavailable/);
  const metadata=(await handler.handleCDPCommand('Target.attachToTarget',{targetId:targetInfo.targetId},browser)).result.sessionId;
  assert.equal((await handler.handleCDPCommand('Target.getTargetInfo',{},metadata)).result.targetInfo,targetInfo);
  await assert.rejects(handler.handleCDPCommand('Runtime.evaluate',{expression:'ignored'},metadata),/does not permit/);
  await handler.handleCDPCommand('Target.detachFromTarget',{sessionId:metadata},browser);
  assert.equal(handler._inspireMetadataSessions.has(metadata),false);
  const treeStart=patched.indexOf('      _handleFrameTree(frameTree) {');
  const treeEnd=patched.indexOf('      _eventBelongsToStaleFrame(',treeStart);
  const frameSession=runInNewContext('({'+patched.slice(treeStart,treeEnd)+'})',{});
  frameSession._crPage={_sessions:new Map([['different-browser-target',frameSession]])};
  frameSession._isMainFrame=()=>true;
  frameSession._onFrameAttached=()=>{};
  frameSession._onFrameNavigated=frame=>assert.equal(frameSession._crPage._sessions.get(frame.id),frameSession);
  frameSession._handleFrameTree({frame:{id:'actual-document-frame'}});
  const positionStart=patched.indexOf('      async _framePosition() {');
  const positionEnd=patched.indexOf('      async _scrollRectIntoViewIfNeeded(',positionStart);
  const position=runInNewContext('({'+patched.slice(positionStart,positionEnd)+'})',{});
  position._isMainFrame=()=>true;
  position._page={frameManager:{frame:()=>{throw Error('根 frame 不能按浏览器目标编号查找');}}};
  const coordinates=await position._framePosition();
  assert.equal(coordinates.x,0);assert.equal(coordinates.y,0);
});

test('选择物理标签页保留上游编号，不使用过滤后的列表位置',async()=>{
  const bridge=new ExtensionBridge({});const selected=[];
  bridge.client={callTool:async args=>selected.push(args.arguments.index)};
  bridge.perform=async op=>op==='tabs'?publicBrowserMetadata([
    {index:0,targetId:'auth',url:'chrome-extension://example/connect.html'},
    {index:1,targetId:'business',url:'https://example.com/'}
  ],'tabs'):{targetId:'business'};
  assert.equal((await bridge.select('business')).targetId,'business');
  assert.deepEqual(selected,[1]);
  await assert.rejects(bridge.select('missing'),e=>e.code==='TAB_GONE');
});

test('导航效果忽略已知追踪参数但保留业务参数、来源和路由',()=>{
  assert.equal(navigationEffectMatches('https://example.com/app#/new','https://example.com/app?spm=tracking&utm_source=campaign#/new'),true);
  assert.equal(navigationEffectMatches('https://example.com/app?id=2#/new','https://example.com/app?id=1#/new'),false);
  assert.equal(navigationEffectMatches('https://other.example/app#/new','https://example.com/app#/new'),false);
  assert.equal(navigationEffectMatches('https://example.com/app#/old','https://example.com/app#/new'),false);
});

test('连接页地址不返回 token，标签页列表仅返回业务网页',()=>{
  const auth={targetId:'a',url:'chrome-extension://example/connect.html?token=test-private-value',title:'Welcome'};
  const result=publicBrowserMetadata(auth,'identity');
  assert.equal(result.connectionPage,true);assert.equal(result.url,'chrome-extension://example/connect.html');
  assert.equal(JSON.stringify(result).includes('test-private-value'),false);
  assert.deepEqual(publicBrowserMetadata([auth,{targetId:'b',url:'https://example.com/'}],'tabs'),[{targetId:'b',url:'https://example.com/'}]);
});
