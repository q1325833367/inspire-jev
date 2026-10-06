import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {capturePage,probeTarget,checkPage,extractPage} from './snapshot.mjs';

const require=createRequire(import.meta.url);
export const EXTENSION_BACKEND_VERSION='0.0.83';
const fail=(code,message)=>Object.assign(Error(message),{code});
export function publicBrowserMetadata(result,op){
  const safe=item=>{
    if(!item?.url)return item;
    const u=new URL(item.url);
    if(u.protocol==='chrome-extension:')return{...item,url:`${u.origin==='null'?'chrome-extension://'+u.host:u.origin}${u.pathname}`,title:'浏览器连接页',connectionPage:true};
    return item;
  };
  return op==='tabs'?result.filter(t=>/^https?:/.test(t.url)).map(safe):op==='identity'?safe(result):result;
}

// Only these source-controlled operations can reach the upstream code tool.
// Neither task text nor a model response is accepted as executable source.
async function operation(page,p){
  const key=Symbol.for('inspirejev.extension.frames.v1');
  const state=page[key]??=( {frames:new WeakMap(),next:0,targets:new Map()} );
  const frameId=frame=>{if(!state.frames.has(frame))state.frames.set(frame,String(++state.next));return state.frames.get(frame);};
  const session=await page.context().newCDPSession(page);
  let info;try{info=(await session.send('Target.getTargetInfo')).targetInfo;}finally{await session.detach();}
  if(p.targetId&&info.targetId!==p.targetId)throw Error('JEV_TAB_CHANGED');
  if(p.op==='identity')return{targetId:info.targetId,url:page.url(),title:await page.title()};
  if(p.op==='tabs'){
    const tabs=[];
    for(const item of page.context().pages()){
      const cdp=await page.context().newCDPSession(item);let target;
      try{target=(await cdp.send('Target.getTargetInfo')).targetInfo;}finally{await cdp.detach();}
      tabs.push({targetId:target.targetId,url:item.url(),title:await item.title(),selected:item===page});
    }return tabs;
  }
  const frames=page.frames();
  const frame=p.frameId?frames.find(f=>frameId(f)===p.frameId):page.mainFrame();
  if(!frame)throw Error('JEV_FRAME_GONE');
  const frameUrl=frame.url(),origin=new URL(frameUrl.startsWith('about:')?page.url():frameUrl).origin;
  if(!p.allowedOrigins?.includes(origin))return{ok:false,notIssued:p.op==='execute',reason:'needs_origin',frameOrigin:origin};
  if(p.op==='observe'){
    for(const handle of state.targets.values())await handle.dispose().catch(()=>{});state.targets.clear();
    const result=await frame.evaluate(capture,p.options);
    if(result)for(const a of result.actions)if(a.selector){const handle=await frame.$(a.selector);if(handle){a.remoteRef=crypto.randomUUID();state.targets.set(a.remoteRef,handle);}}
    return{page:result,outerUrl:page.url(),frameId:frameId(frame),frames:frames.map(f=>({id:frameId(f),url:f.url()}))};
  }
  if(p.op==='check')return frame.evaluate(check,p.checks);
  if(p.op==='extract')return frame.evaluate(extract,p.specs);
  if(p.op==='probe'){
    const handle=p.action.remoteRef?state.targets.get(p.action.remoteRef):null;
    if(p.action.remoteRef&&!handle)return{ok:false,reason:'target_expired'};
    return handle?handle.evaluate(probe,p.action):frame.evaluate(probe,p.action);
  }
  if(p.op==='execute'){
    const a=p.action,handle=a.remoteRef?state.targets.get(a.remoteRef):null;
    if(a.remoteRef&&!handle)return{ok:false,notIssued:true,reason:'target_expired'};
    const guard=handle?await handle.evaluate(probe,a):await frame.evaluate(probe,a);
    if(!guard.ok)return{notIssued:true,...guard};
    const l=handle||(a.selector?frame.locator(a.selector):null),options={timeout:3000};
    if(a.kind==='click')await l.click(options);
    else if(a.kind==='fill')await l.fill(String(p.value),options);
    else if(a.kind==='check')await l.setChecked(Boolean(p.value),options);
    else if(a.kind==='select')await l.selectOption(a.value,options);
    else if(a.kind==='press')await l.press(a.key,options);
    else if(a.kind==='scroll'){if(a.region)await frame.locator(a.region).hover(options);await page.mouse.wheel(0,a.direction==='down'?550:-550);}
    else if(a.kind==='back')await page.goBack({waitUntil:'domcontentloaded',timeout:10000});
    else if(a.kind!=='wait')throw Error('JEV_UNSUPPORTED_ACTION');
    return{ok:true};
  }
  throw Error('JEV_UNKNOWN_OPERATION');
}

export class ExtensionBridge{
  constructor(config,{cdpEndpoint,clientFactory}={}){
    this.config=config;this.cdpEndpoint=cdpEndpoint;this.clientFactory=clientFactory;this.queue=Promise.resolve();
    this.browserId=createHash('sha256').update(JSON.stringify([config.extensionBrowser||'chrome',config.extensionProfile||'Default'])).digest('hex');
  }
  async connect(){
    if(this.client)return this.info;
    if(this.connecting)return this.connecting;
    this.connecting=(async()=>{
      const args=[...(!this.cdpEndpoint?['--import',fileURLToPath(new URL('./extension-compat.mjs',import.meta.url))]:[]),join(dirname(require.resolve('@playwright/mcp/package.json')),'cli.js'),...(this.cdpEndpoint?['--cdp-endpoint',this.cdpEndpoint]:['--extension','--browser',this.config.extensionBrowser||'chrome','--profile-dir-name',this.config.extensionProfile||'Default']),'--console-level','error','--snapshot-mode','none','--no-webmcp','--timeout-settle','0'];
      const env={...process.env};delete env.DEBUG;
      for(const key of Object.keys(env))if(/API_KEY|PASSWORD|SECRET|TOKEN/.test(key))delete env[key];
      if(this.config.extensionToken)env.PLAYWRIGHT_MCP_EXTENSION_TOKEN=this.config.extensionToken;
      this.transport=new StdioClientTransport({command:process.execPath,args,env,stderr:'pipe'});
      // Upstream diagnostic output can include profile paths or connection URLs.
      // Consume it without persisting it as a product trace.
      this.transport.stderr?.on('data',()=>{});
      const client=this.clientFactory?this.clientFactory():new Client({name:`InspireJev ${this.config.host}`,version:this.config.version});
      try{await client.connect(this.transport);const tools=await client.listTools();
        if(!tools.tools.some(t=>t.name==='browser_run_code_unsafe'))throw fail('EXTENSION_BACKEND_INCOMPATIBLE','浏览器连接后端缺少固定模板执行能力');
        this.client=client;this.info={backend:'playwright-extension',backendVersion:EXTENSION_BACKEND_VERSION,browserId:this.browserId,profile:this.config.extensionProfile||'Default'};return this.info;
      }catch(e){await client.close().catch(()=>{});this.transport=undefined;throw e;}
    })();try{return await this.connecting;}finally{this.connecting=null;}
  }
  serial(work){const pending=this.queue.then(work,work);this.queue=pending.catch(()=>{});return pending;}
  async perform(op,params={}, {signal}={}){
    if(!['identity','tabs','observe','check','extract','probe','execute'].includes(op))throw fail('INVALID_BRIDGE_OPERATION','不支持的浏览器操作');
    return this.serial(async()=>{
      if(signal?.aborted)throw Object.assign(fail('CANCELLED','执行已取消'),{notIssued:true});
      await this.connect();
      if(signal?.aborted)throw Object.assign(fail('CANCELLED','执行已取消'),{notIssued:true});
      const payload={...params,op};
      const code=`async (page) => { const capture=${capturePage}; const probe=${probeTarget}; const check=${checkPage}; const extract=${extractPage}; return (${operation})(page,${JSON.stringify(payload)}); }`;
      let response;
      try{response=await this.client.callTool({name:'browser_run_code_unsafe',arguments:{code}},{timeout:30000,signal});}
      catch{throw fail(this.authorized?'EXTENSION_CONNECTION_LOST':'EXTENSION_CONNECTION_REQUIRED',this.authorized?'已有浏览器连接不可用；不会创建替代网页':'需要完成官方扩展的连接授权；不会创建替代网页');}
      const text=response.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'';
      if(response.isError){
        const code=text.includes('Target.attachToBrowserTarget')&&text.includes('Not allowed')?'EXTENSION_METADATA_UNSUPPORTED':text.includes('JEV_TAB_CHANGED')?'TAB_CHANGED':text.includes('JEV_FRAME_GONE')?'FRAME_GONE':text.includes('Extension')?'EXTENSION_CONNECTION_REQUIRED':'EXTENSION_OPERATION_FAILED';
        throw fail(code,code==='EXTENSION_METADATA_UNSUPPORTED'?'官方扩展拒绝标签页身份读取；无需重新登录网站':'已有标签页操作失败；请检查连接授权和原现场');
      }
      const match=text.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/);
      if(!match)throw fail('EXTENSION_BACKEND_INCOMPATIBLE','连接后端未返回结构化操作结果');
      try{const result=JSON.parse(match[1].trim());this.authorized=true;return publicBrowserMetadata(result,op);}catch{throw fail('EXTENSION_BACKEND_INCOMPATIBLE','连接后端结果格式不兼容');}
    });
  }
  async select(targetId){
    const tabs=await this.perform('tabs');const index=tabs.findIndex(t=>t.targetId===targetId);
    if(index<0)throw fail('TAB_GONE','原标签页不在当前授权范围；不会新建替代页面');
    await this.serial(()=>this.client.callTool({name:'browser_tabs',arguments:{action:'select',index}}));
    return this.perform('identity',{targetId});
  }
  async close(){await this.queue;await this.client?.close();this.client=null;this.info=null;}
}
