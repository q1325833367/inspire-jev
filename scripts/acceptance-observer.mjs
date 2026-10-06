import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {access} from 'node:fs/promises';
import {ledger,json,hash} from './acceptance-evidence.mjs';
import {pathToFileURL} from 'node:url';

// Test-only observer. It never adds tools or returns its observations to the model.
export async function createObserver(agent){
 const context=await json(process.env.INSPIRE_JEV_ACCEPTANCE_CONTEXT),{toolDefinitions,toolJSONSchema}=await import(context.runtimeRoot?pathToFileURL(join(context.runtimeRoot,'src','tools.mjs')).href:new URL('../src/tools.mjs',import.meta.url).href),emit=await ledger(join(context.directory,'observer.jsonl'));
 if(context.entry!==agent.config.host)throw Error('验收观察器与宿主身份不一致');
 await emit({type:'runtime',jobId:context.id,protocolHash:context.protocolHash,packageSHA256:context.packageSHA256,engine:agent.config.version,buildFingerprint:agent.config.buildFingerprint,host:agent.config.host,toolFingerprint:hash(toolDefinitions.map(d=>({name:d.name,schema:toolJSONSchema(d)}))),pid:process.pid,platform:process.platform,arch:process.arch});
 const sessions=new Map();
 const controller=new AbortController(),timer=setInterval(()=>access(join(context.directory,'cancel.request')).then(()=>controller.abort()).catch(()=>{}),1000);timer.unref();
 async function capture(sessionId){
  const s=sessions.get(sessionId);if(!s||s.page.isClosed())return;
  const origin=new URL(s.page.url()).origin;if(!s.record.allowedOrigins.includes(origin))return;
  const snapshot=await s.page.evaluate(({caseId,expectedNameHash})=>{
   const text=s=>document.querySelector(s)?.textContent?.replace(/\s+/g,' ').trim()||'',items=(s,n=40)=>Array.from(document.querySelectorAll(s)).slice(0,n).map(e=>({text:e.textContent.replace(/\s+/g,' ').trim().slice(0,5000),href:e.getAttribute('href')}));
   const base={url:location.href,title:document.title};
   if(location.hostname==='en.wikipedia.org'){
    const heading=document.querySelector('#Death'),container=heading?.closest('.mw-heading')||heading;let p=container?.nextElementSibling;while(p&&p.tagName!=='P'&&!/^H[1-6]$/.test(p.tagName))p=p.nextElementSibling;
    return{...base,heading:text('#firstHeading'),fields:items('.infobox tr',40).map(x=>x.text),section:text('#Death'),paragraph:p?.tagName==='P'?p.textContent.trim().slice(0,5000):null};
   }
   if(location.hostname==='www.gutenberg.org')return{...base,heading:text('h1'),search:items('.booklink',3).map(x=>x.text),books:items('.booklink a.link',3),ranking:items('#books-last1 + ol li a',27),metadata:items('table.bibrec tr',40).map(x=>x.text),formats:items('#download a.read-online-button,#download a.featured-format-link,#download a.other-format-link',100),formatCount:document.querySelectorAll('#download a.read-online-button,#download a.featured-format-link,#download a.other-format-link').length};
   if(location.hostname==='github.com'){
    if(caseId==='github-private-draft'){
     const name=document.querySelector('#repository-name-input,#repository_name,input[name="repository[name]"],input[aria-label="Repository name"]'),description=document.querySelector('input[name="Description"],#repository_description,input[name="repository[description]"],textarea[name="repository[description]"]'),privateControl=document.querySelector('input[value="private"],input#repository_visibility_private');
     const value=description?.value||'';
     return{...base,privateForm:{name:name?.value||'',description:value,descriptionLength:Array.from(value).length,descriptionChinese:/[\u4e00-\u9fff]/.test(value),descriptionUse:/网页|浏览器|网站/.test(value),privateChecked:privateControl?.checked===true},authenticated:!!document.querySelector('meta[name="user-login"][content]:not([content=""])')};
    }
    const license=text('.react-code-lines');return{...base,authenticated:!!document.querySelector('meta[name="user-login"][content]:not([content=""])'),readme:text('article.markdown-body').slice(0,1500),license:license.slice(0,5000),licenseTruncated:license.length>5000};
   }
   return base;
  },{caseId:context.caseId});
  if(snapshot.privateForm){snapshot.privateForm.nameMatches=hash(snapshot.privateForm.name)===context.expectedNameHash;snapshot.privateForm.descriptionHash=hash(snapshot.privateForm.description);delete snapshot.privateForm.name;delete snapshot.privateForm.description;}
  await emit({type:'snapshot',sessionId,profileId:s.record.profileId,snapshot});
 }
 return{
  signal:controller.signal,
  async nativeTools(names){await emit({type:'native_tools',names});},
  async beforeTool(name,args){const ticket={id:randomUUID(),start:performance.now()};await emit({type:'tool_start',callId:ticket.id,name,action:args.action,argsHash:hash(args),sessionId:args.sessionId||args.task?.sessionId,runId:args.runId});return ticket;},
  async afterTool(ticket,name,args,result){const normalized=Array.isArray(result)?{sessions:result}:result;await emit({type:'tool_end',callId:ticket.id,name,resultHash:hash(normalized),durationMs:performance.now()-ticket.start,status:result?.status,reason:result?.reason,runId:result?.runId,actions:result?.actions,handoffs:result?.handoffs,versions:result?.versions,actionId:result?.actionId,effect:result?.effect,metrics:result?.metrics,textGeneration:result?.textGeneration,collection:context.caseId==='github-private-draft'?undefined:result?.data});for(const id of sessions.keys())await capture(id);},
  async toolError(ticket,name,error){await emit({type:'tool_error',callId:ticket.id,name,durationMs:performance.now()-ticket.start,errorCode:error.code||error.name});},
  async onSession(s){sessions.set(s.record.id,s);s.page.on('request',request=>{if(request.method()!=='POST')return;const u=new URL(request.url());const creation=/\/repositories(?:\/|$)|\/repos(?:\/|$)/.test(u.pathname)||/createRepository/.test(request.postData()||'');emit({type:'request',sessionId:s.record.id,origin:u.origin,path:u.pathname,method:'POST',repositoryCreation:creation}).catch(()=>{});});await emit({type:'session',sessionId:s.record.id,profileId:s.record.profileId,allowedOrigins:s.record.allowedOrigins,physicalIdentity:s.adapter.identity,driver:(await s.adapter.capabilities()).driver,browserVersion:s.context.browser()?.version(),viewport:s.page.viewportSize()});},
  async onExecution(sessionId,event){const a=event.action,s=sessions.get(sessionId);let directoryLink;
   if(event.phase==='issued'&&context.caseId==='wiki-section'&&a.selector)directoryLink=await s.page.evaluate(selector=>!!document.querySelector(selector)?.closest('#vector-toc,#toc,[role="navigation"][aria-label="Contents"]'),a.selector);
   await emit({type:'action',sessionId,executionId:event.executionId,phase:event.phase,kind:a.kind,href:a.href,documentUrl:a.documentUrl,frameOrigin:a.frameOrigin,isSubmit:!!a.isSubmit,valueHash:event.valueHash,directoryLink,errorCode:event.errorCode});if(event.phase==='acknowledged')await capture(sessionId);}
 };
}
