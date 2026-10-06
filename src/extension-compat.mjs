import {registerHooks,createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Apache-2.0 adaptation of Playwright's ExtensionProtocolV2, pinned to MCP 0.0.83.
// Chrome's extension transport rejects a second browser-target attachment.
// Metadata-only aliases reuse already-authorized targets; all other commands fail closed.
export const UPSTREAM_CORE_SHA256='cd6730be1bbcff00771a0fc1390f200306d28428ce68e305420ca623cb39cdeb';
export function patchExtensionProtocol(source){
  if(createHash('sha256').update(source).digest('hex')!==UPSTREAM_CORE_SHA256)throw Error('扩展后端版本指纹不匹配');
  const anchor='      async handleCDPCommand(method, params2, sessionId) {\n        switch (method) {';
  const replacement=`      async handleCDPCommand(method, params2, sessionId) {
        this._inspireMetadataSessions ??= new Map();
        const aliases = this._inspireMetadataSessions;
        if (method === "Target.attachToBrowserTarget" && !sessionId) {
          const id = "inspire-browser-" + crypto.randomUUID();
          aliases.set(id, null);
          return { result: { sessionId: id } };
        }
        if (aliases.has(sessionId)) {
          if (method === "Target.attachToTarget" && aliases.get(sessionId) === null) {
            const tab = this._model._findTabSession(s => s.targetInfo?.targetId === params2?.targetId);
            if (!tab) throw new Error("Authorized tab is unavailable");
            const id = "inspire-metadata-" + crypto.randomUUID();
            aliases.set(id, tab.sessionId);
            return { result: { sessionId: id } };
          }
          if (method === "Target.getTargetInfo" && aliases.get(sessionId)) {
            const targetInfo = this._model.getTargetInfo(aliases.get(sessionId));
            if (!targetInfo) throw new Error("Authorized tab is unavailable");
            return { result: { targetInfo } };
          }
          if (method === "Target.detachFromTarget" && aliases.has(params2?.sessionId)) {
            aliases.delete(params2.sessionId);
            return { result: {} };
          }
          throw new Error("Metadata session does not permit this command");
        }
        switch (method) {`;
  if(source.split(anchor).length!==2)throw Error('扩展兼容补丁位置不匹配');
  const frameAnchor='      _handleFrameTree(frameTree) {\n        this._onFrameAttached(frameTree.frame.id, frameTree.frame.parentId || null);\n        this._onFrameNavigated(frameTree.frame, true);';
  if(source.split(frameAnchor).length!==4)throw Error('扩展 frame 兼容补丁位置不匹配');
  const positionAnchor='      async _framePosition() {\n        var _stack = [];';
  if(source.split(positionAnchor).length!==2)throw Error('扩展坐标兼容补丁位置不匹配');
  return source.replace(anchor,replacement).replace(frameAnchor,
    '      _handleFrameTree(frameTree) {\n        this._onFrameAttached(frameTree.frame.id, frameTree.frame.parentId || null);\n        if (this._isMainFrame() && !frameTree.frame.parentId) this._crPage._sessions.set(frameTree.frame.id, this);\n        this._onFrameNavigated(frameTree.frame, true);').replace(positionAnchor,
    '      async _framePosition() {\n        if (this._isMainFrame()) return { x: 0, y: 0 };\n        var _stack = [];');
}
const require=createRequire(import.meta.url);
const backendRequire=createRequire(require.resolve('@playwright/mcp/package.json'));
const upstreamUrl=pathToFileURL(join(dirname(backendRequire.resolve('playwright-core/package.json')),'lib/coreBundle.js')).href;
registerHooks({load(url,context,nextLoad){
  const result=nextLoad(url,context);
  if(url===upstreamUrl)return {...result,source:patchExtensionProtocol(String(result.source))};
  return result;
}});
