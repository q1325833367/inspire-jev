import {createHash,randomUUID} from 'node:crypto';
import {capturePage,probeTarget,checkPage,extractPage} from './snapshot.mjs';
import {traceStep} from './trace.mjs';

export function browserAdapter(tab,{browserId='iab',driver='desktop',instanceId='desktop',sessionId,allowedOrigins,trace,onAction,checkExtra,navigationState}={}) {
  const span=(name,data,work,summary)=>traceStep(api.trace,name,data,work,summary);
  const history=[...(navigationState?.urls||[])];let historyIndex=navigationState?.index??-1,backPending=false,nextCursor=null,lastPage,registry=new Map(),siteTools;
  const owned=driver==='playwright';
  const prepared=new Map();
  const frameAt = index => owned ? tab.playwright.frames()[index||0] : tab.playwright;
  const findElement=async(frame,selector)=>{const handle=await frame.evaluateHandle(selector=>document.querySelector(selector),selector),element=handle.asElement();if(!element)await handle.dispose();return element;};
  const evaluate = (fn,arg,index=0) => frameAt(index).evaluate(fn,arg);
  const locator = action => frameAt(action.frameIndex||0).locator(action.selector);
  const url=()=>owned?Promise.resolve(tab.playwright.url()):tab.url();
  const api={
    trace,sessionId,allowedOrigins,
    identity:`${driver}:${browserId}:${instanceId}:tab:${tab.id}`,
    navigationState(){return{urls:history.slice(),index:historyIndex};},
    async capabilities(){return{driver,browserId,implemented:['click','fill','select','check','press','scroll','wait','observe',...(typeof tab.back==='function'?['back']:[])],frames:owned?'implemented':'handoff',shadowDOM:'handoff',canvas:'handoff',sensitiveInput:'host_only',siteTools:null};},
    async discoverSiteTools(){
      if(!tab.capabilities)return null;
      const capability=await span('browser.webmcp.get',{},()=>tab.capabilities.get('webmcp'));
      siteTools=await span('browser.webmcp.fetch',{},()=>capability.fetchTools());return siteTools.description();
    },
    async callSiteTool(name,input){if(!siteTools)throw Error('网站工具尚未发现');return siteTools.call(name,input);},
    async observe(options={}){
      if(prepared.size){await Promise.allSettled([...prepared.values()].map(h=>h.dispose()));prepared.clear();}
      let cursor=options.cursor||nextCursor;nextCursor=null;
      let frameIndex=cursor?.frameIndex||0;
      if(owned&&options.frame){const element=await findElement(tab.playwright,options.frame);const frame=await element?.contentFrame();await element?.dispose();const requested=tab.playwright.frames().indexOf(frame);if(requested<0)throw Error('未找到指定 frame');if(cursor?.frameIndex!==requested)cursor=null;frameIndex=requested;}
      const frames=owned?tab.playwright.frames():[tab.playwright];if(frameIndex>=frames.length){frameIndex=0;cursor=null;}
      if(owned&&frameIndex>0&&api.allowedOrigins?.length){const owner=await url(),frameUrl=frames[frameIndex].url(),origin=new URL(frameUrl.startsWith('about:')?owner:frameUrl).origin;if(!api.allowedOrigins.includes(origin)){const p={url:owner,frameUrl,title:'未授权 frame',text:'',actions:[],cursor:frameIndex+1<frames.length?{frameIndex:frameIndex+1}:null,coverage:{truncated:frameIndex+1<frames.length,scannedNodes:0,unsupported:{frameOrigin:origin}}};if(p.cursor)p.actions.push({id:'observe_more',kind:'observe',label:'继续发现其他 frame'});lastPage=p;return p;}}
      let page=await span('browser.dom.capture',{frame_index:frameIndex},()=>evaluate(capturePage,{cursor,limits:options.limits},frameIndex),p=>({candidate_count:p?.actions.length,coverage:p?.coverage}));
      if(!page){if(owned)await tab.playwright.waitForLoadState('domcontentloaded',{timeout:3000});else if(tab.playwright.waitForLoadState)await tab.playwright.waitForLoadState({state:'domcontentloaded',timeoutMs:3000});page=await evaluate(capturePage,{cursor},frameIndex);}
      if(!page)throw Error('页面尚未准备好');
      const outerUrl=await url();page.frameUrl=page.url;page.url=outerUrl;
      for(const a of page.actions){a.frameIndex=frameIndex;a.frameUrl=page.frameUrl;a.frameOrigin=new URL(page.frameUrl.startsWith('about:')?outerUrl:page.frameUrl).origin;}
      if(page.cursor)page.cursor.frameIndex=frameIndex;
      else if(owned&&frameIndex+1<frames.length)page.cursor={frameIndex:frameIndex+1};
      if(page.cursor&&!page.actions.some(a=>a.kind==='observe'))page.actions.push({id:'observe_more',kind:'observe',label:'继续发现下一批候选'});
      page.coverage.truncated=!!page.cursor;
      if(outerUrl!==history[historyIndex]){if(backPending&&outerUrl===history[historyIndex-1])historyIndex--;else{history.splice(historyIndex+1);history.push(outerUrl);historyIndex++;if(history.length>201){history.shift();historyIndex--;}}backPending=false;}
      if(historyIndex>0&&typeof tab.back==='function')page.actions.push({id:'host_back',kind:'back',role:'browser',label:'返回浏览器上一页',source:'host',href:history[historyIndex-1]});
      const generation=randomUUID();registry=new Map();
      for(const a of page.actions){a.ref=`${generation}:${a.id}`;registry.set(a.ref,a);}
      page.revision=createHash('sha256').update(JSON.stringify([outerUrl,page.documentId,page.frameUrl,page.actions.map(a=>[a.kind,a.label,a.href,a.value,a.checked])])).digest('hex');
      lastPage=page;return page;
    },
    async expand(page){if(!page.cursor)throw Error('没有更多观测范围');nextCursor=page.cursor;},
    async validate(action){
      if(action.kind==='back')return{ok:action.href===history[historyIndex-1]&&await url()===history[historyIndex]};
      if(action.kind==='observe')return{ok:!!lastPage?.cursor};
      if(owned&&action.selector){const handle=await findElement(frameAt(action.frameIndex),action.selector);if(!handle)return{ok:false,reason:'target_missing'};let guard=await span('browser.target.validate',{kind:action.kind,target_ref:api.trace?.ref(action.selector)},()=>handle.evaluate(probeTarget,action),p=>({ok:p.ok,reason:p.reason}));
        if(guard.ok&&action.kind==='click'){try{await span('browser.click.readiness',{target_ref:api.trace?.ref(action.selector)},()=>handle.click({trial:true,timeout:500}));guard=await handle.evaluate(probeTarget,action);}catch{guard={ok:false,reason:'target_not_ready'};}}
        if(guard.ok){await prepared.get(action.ref)?.dispose();prepared.set(action.ref,handle);}else await handle.dispose();return guard;}
      return span('browser.target.validate',{kind:action.kind,target_ref:api.trace?.ref(action.selector||action.id)},()=>evaluate(probeTarget,action,action.frameIndex),p=>({ok:p.ok,reason:p.reason}));
    },
    async check(checks){
      const grouped=new Map();for(const c of checks){const k=c.frame||'';if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(c);}
      const details=[];let first;
      for(const [frameSelector,list] of grouped){
        let index=0;
        if(frameSelector){if(!owned){details.push(...list.map(c=>({kind:c.kind,ok:false,reason:'frame_handoff'})));continue;}const handle=await findElement(tab.playwright,frameSelector);const frame=await handle?.contentFrame();await handle?.dispose();index=tab.playwright.frames().indexOf(frame);if(index<0){details.push(...list.map(c=>({kind:c.kind,ok:false,reason:'frame_missing'})));continue;}if(api.allowedOrigins?.length){const frameUrl=frame.url(),origin=new URL(frameUrl.startsWith('about:')?await url():frameUrl).origin;if(!api.allowedOrigins.includes(origin)){details.push(...list.map(c=>({kind:c.kind,ok:false,reason:'needs_origin',frameOrigin:origin})));continue;}}}
        const evidence=await span('browser.dom.check',{check_kinds:list.map(c=>c.kind)},()=>evaluate(checkPage,list,index),r=>({ok:r.ok}));
        first||=evidence;details.push(...evidence.details.map(d=>({...d,frame:frameSelector||undefined})));
      }
      const result={...first,url:await url(),ok:details.length>0&&details.every(c=>c.ok),details};
      return checkExtra?checkExtra(result):result;
    },
    async extract(specs){return span('browser.extract',{field_count:specs.length},()=>evaluate(extractPage,specs),r=>({field_count:Object.keys(r.data).length}));},
    async checkAction(action){
      if(action.effectUrl){const actual=await url();return{ok:actual===action.effectUrl,actual,expected:action.effectUrl};}
      if(['fill','check','select'].includes(action.kind)){
        const identity=await evaluate(probeTarget,{documentId:action.documentId,documentUrl:action.documentUrl},action.frameIndex);if(!identity.ok)return identity;
        const c={kind:{fill:'field',check:'checked',select:'selected'}[action.kind],selector:action.selector,equals:action.expectedValue};
        if(action.kind==='select')c.equals=action.label.split(' → ').slice(1).join(' → ');
        if(action.kind==='fill'){delete c.equals;c.notEmpty=true;const ev=await evaluate(checkPage,[c],action.frameIndex);ev.ok=createHash('sha256').update(String(ev.details[0]?.actual??'')).digest('hex')===action.expectedHash;return ev;}
        return evaluate(checkPage,[c],action.frameIndex);
      }
      if(action.href){const actual=await url(),expected=new URL(action.href,action.documentUrl||actual).href;return{ok:actual===expected,actual,expected};}
      return{ok:false,reason:'effect_requires_business_check'};
    },
    async execute(action,value,{signal,alreadyValidated=false}={}){
      if(signal?.aborted)throw Object.assign(Error('执行已取消'),{name:'AbortError',notIssued:true});
      api.trace?.addSecrets([value]);
      if(!alreadyValidated&&!(await api.validate(action)).ok)throw Error('目标已变化，请重新观测');
      const meta={kind:action.kind,target_ref:api.trace?.ref(action.selector||action.id)},opts=owned?{timeout:3000}:{timeoutMs:3000};
      let issued=false;const invoke=(operation,work)=>span(operation,meta,()=>{if(signal?.aborted)throw Object.assign(Error('执行已取消'),{name:'AbortError',notIssued:!issued});issued=true;return work();});
      if(action.kind==='observe'){await api.expand(lastPage);return;}
      if(action.kind==='wait'){await span('browser.wait',{},()=>new Promise(resolve=>setTimeout(resolve,150)));return;}
      if(action.kind==='back'){backPending=true;await invoke('browser.back',()=>tab.back(action.href));}
      else if(action.kind==='scroll'){
        if(!owned)await invoke('browser.scroll',()=>tab.scroll([action.x,action.y],action.direction,1));
        else{if(action.region)await invoke('browser.hover',()=>locator({...action,selector:action.region}).hover());await invoke('browser.wheel',()=>tab.playwright.mouse.wheel(0,action.direction==='down'?550:-550));}
      }else{
        const l=owned?prepared.get(action.ref):locator(action);if(!l)throw Object.assign(Error('目标句柄已过期，请重新观测'),{code:'TARGET_CHANGED',notIssued:true});
        try{
        if(action.kind==='click'){
          const point=!owned&&typeof tab.click==='function'?await l.evaluate(clickPoint):null;
          if(point)await invoke('browser.click.native',()=>tab.click(point));else await invoke('browser.click',()=>l.click(opts));
        }else if(action.kind==='fill')await invoke('browser.fill',()=>l.fill(String(value),opts));
        else if(action.kind==='check')await invoke('browser.setChecked',()=>l.setChecked(Boolean(value),opts));
        else if(action.kind==='select')await invoke('browser.select',()=>l.selectOption(action.value,opts));
        else if(action.kind==='press')await invoke('browser.press',()=>l.press(action.key,opts));
        else throw Error('不支持的操作');
        }finally{if(owned){prepared.delete(action.ref);await l.dispose();}}
      }
      await onAction?.(action);
    },
    resolveRef(ref){const action=registry.get(ref);if(!action)throw Error('引用已过期；请检查会话获取新鲜引用');return action;},
    publicView(page=lastPage){if(!page)return null;return{...page,actions:page.actions.map(({formGuard,documentId,documentUrl,frameUrl,frameOrigin,...a})=>({...a,...(frameUrl&&frameUrl!==page.frameUrl?{frameUrl,frameOrigin}:{})}))};},
    async screenshot(){if(owned)return tab.playwright.screenshot({type:'png'});if(tab.screenshot)return tab.screenshot();return null;},
  };
  return api;
}

function clickPoint(e){
  const b=e.getBoundingClientRect(),owns=(x,y)=>{const hit=document.elementFromPoint(x,y);return hit===e||e.contains(hit);};
  if(owns(b.x+b.width/2,b.y+b.height/2))return null;
  for(const r of e.getClientRects()){const x=r.x+r.width/2,y=r.y+r.height/2;if(r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&owns(x,y))return[x,y];}
  return null;
}
