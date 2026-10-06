import {randomUUID,createHash} from 'node:crypto';
import {traceStep} from './trace.mjs';

export function extensionAdapter(bridge,{targetId,sessionId,allowedOrigins=[]}){
  let lastPage,nextCursor,registry=new Map(),frameIds=[];
  const history=[];
  const call=(op,data={},options)=>traceStep(api.trace,`browser.extension.${op}`,{browser_identity:api.identity},()=>bridge.perform(op,{...data,targetId,allowedOrigins:api.allowedOrigins},options),r=>({ok:r?.ok,reason:r?.reason}));
  const api={
    sessionId,allowedOrigins,identity:`extension:${bridge.browserId}:tab:${targetId}`,
    navigationState:()=>({urls:history.slice(),index:history.length-1}),
    async capabilities(){return{driver:'playwright-extension',browserId:bridge.browserId,implemented:['click','fill','check','select','press','scroll','back','wait','observe'],frames:'implemented',siteTools:false};},
    async observe(options={}){
      const cursor=options.cursor||nextCursor||(lastPage?.frameId?{frameId:lastPage.frameId}:undefined);nextCursor=null;
      const r=await call('observe',{frameId:cursor?.frameId,options:{cursor,limits:options.limits}});
      if(r.reason==='needs_origin')throw Object.assign(Error('当前 frame 来源未授权'),{code:'NEEDS_ORIGIN',details:r});
      if(!r.page)throw Object.assign(Error('原页面尚未准备好'),{code:'PAGE_NOT_READY'});
      frameIds=r.frames.map(f=>f.id);const p=r.page;
      p.frameUrl=p.url;p.url=r.outerUrl;p.frameId=r.frameId;p.frames=r.frames;
      const frameOrigin=new URL(p.frameUrl.startsWith('about:')?p.url:p.frameUrl).origin;
      const generation=randomUUID();registry=new Map();
      for(const a of p.actions){a.frameId=r.frameId;a.frameUrl=p.frameUrl;a.frameOrigin=frameOrigin;a.ref=`${generation}:${a.id}`;registry.set(a.ref,a);}
      if(p.cursor)p.cursor.frameId=r.frameId;
      else{const index=frameIds.indexOf(r.frameId);if(index+1<frameIds.length)p.cursor={frameId:frameIds[index+1]};}
      if(p.cursor&&!p.actions.some(a=>a.kind==='observe')){const a={id:'observe_more',kind:'observe',label:'继续发现下一批候选',ref:`${generation}:observe_more`};p.actions.push(a);registry.set(a.ref,a);}
      p.coverage.truncated=!!p.cursor;
      p.revision=createHash('sha256').update(JSON.stringify([p.url,p.frameId,p.documentId,p.actions.map(a=>[a.kind,a.label,a.href,a.value,a.checked])])).digest('hex');
      if(history.at(-1)!==p.url)history.push(p.url);
      lastPage=p;return p;
    },
    async expand(p){if(!p.cursor)throw Error('没有更多观测范围');nextCursor=p.cursor;},
    async validate(a){if(a.kind==='observe')return{ok:!!lastPage?.cursor};return call('probe',{frameId:a.frameId,action:a});},
    async execute(a,value,{signal}={}){
      if(signal?.aborted)throw Object.assign(Error('执行已取消'),{notIssued:true,name:'AbortError'});
      api.trace?.addSecrets([value]);
      if(a.kind==='observe'){await api.expand(lastPage);return;}
      const r=await call('execute',{frameId:a.frameId,action:a,value},{signal});
      if(!r.ok)throw Object.assign(Error('目标已变化；动作未执行'),{notIssued:!!r.notIssued,code:r.reason==='needs_origin'?'NEEDS_ORIGIN':'TARGET_CHANGED'});
    },
    async check(checks){
      const details=[];let url;
      for(const c of checks){
        if(c.frame){details.push({kind:c.kind,ok:false,reason:'frame_selector_unsupported'});continue;}
        const ids=c.frameId?[c.frameId]:frameIds.length?frameIds:[undefined];let found=[];
        for(const id of ids){const e=await call('check',{frameId:id,checks:[c]});url||=e.url;
          if(e.reason==='needs_origin')continue;
          const d=e.details?.[0];if(d?.ok||d?.count>0)found.push({...d,frameId:id});
          if(['url','title'].includes(c.kind))break;
        }
        details.push(found.length===1?found[0]:{kind:c.kind,ok:false,reason:found.length>1?'ambiguous_check':'missing_or_unverified',count:found.length});
      }
      return{ok:details.length>0&&details.every(d=>d.ok),details,url};
    },
    async extract(specs){
      const data={},coverage={};
      for(const spec of specs){const r=await call('extract',{frameId:spec.frameId||lastPage?.frameId,specs:[spec]});Object.assign(data,r.data);Object.assign(coverage,r.coverage);}
      return{data,coverage,url:lastPage?.url};
    },
    async checkAction(a){
      if(a.effectUrl||a.href){const r=await call('identity');return{ok:a.effectUrl?r.url===a.effectUrl:navigationEffectMatches(r.url,new URL(a.href,a.documentUrl||r.url).href)};}
      const kinds={fill:'field',check:'checked',select:'selected'};
      if(!kinds[a.kind])return{ok:false,reason:'effect_requires_business_check'};
      const guard=await call('probe',{frameId:a.frameId,action:{documentId:a.documentId,documentUrl:a.documentUrl}});if(!guard.ok)return guard;
      const c={kind:kinds[a.kind],selector:a.selector,equals:a.expectedValue};
      if(a.kind==='fill'){delete c.equals;c.notEmpty=true;}
      if(a.kind==='select')c.equals=a.label.split(' → ').slice(1).join(' → ');
      const r=await call('check',{frameId:a.frameId,checks:[c]});
      if(a.kind==='fill')r.ok=createHash('sha256').update(String(r.details?.[0]?.actual??'')).digest('hex')===a.expectedHash;
      return r;
    },
    resolveRef(ref){const a=registry.get(ref);if(!a)throw Error('引用已过期，请重新观测');return a;},
    publicView(p=lastPage){return p;}
  };return api;
}

export function navigationEffectMatches(actual,expected){
  const normalize=value=>{const url=new URL(value);for(const key of [...url.searchParams.keys()])if(key==='spm'||key.startsWith('utm_'))url.searchParams.delete(key);return url.href;};
  return normalize(actual)===normalize(expected);
}
