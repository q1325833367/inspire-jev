import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {settings,VERSION} from './config.mjs';
import {Store,safeId} from './storage.mjs';
import {Sessions} from './sessions.mjs';
import {run,resume,validateTask,resolveChecks} from './core.mjs';
import {createServices,loadConfig} from './providers.mjs';
import {acquire} from './locks.mjs';
import {localTrace} from './runtime.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Agent {
  static async create(overrides={}){
    const config=await settings({host:'mcp',version:VERSION,...overrides});safeId(config.host);
    const store=await new Store(config.home,config.host).init();
    await store.cleanup({dryRun:false});
    return new Agent(config,store,overrides.services);
  }
  constructor(config,store,services){this.config=config;this.store=store;this.sessions=new Sessions(config,store);this.injectedServices=services;this.controllers=new Map();this.sessionRuns=new Map();this.serviceSets=new Set();this.cleanupTimer=setInterval(()=>store.cleanup({dryRun:false}).catch(()=>{}),6*3600000);this.cleanupTimer.unref();}
  async services(trace){if(this.injectedServices)return this.injectedServices;const service=createServices(await loadConfig(this.config.envFile),{trace,proxy:this.config.modelProxy});this.serviceSets.add(service);return service;}
  summary(record){
    const r=record.result||record.progress||{};
    return{runId:record.runId,sessionId:record.sessionId,requestId:record.requestId,status:record.status,active:!!record.active,reason:r.reason,detail:r.detail,
      completed:r.completed,remaining:r.remaining,actions:r.actions,handoffs:r.handoffs,elapsed_ms:r.elapsed_ms,metrics:r.metrics,data:r.data,proof:r.proof,url:r.url,
      checkpointId:record.checkpoint?record.runId:undefined,traceFile:r.traceFile,versions:r.versions||{engine:VERSION},browserMode:record.browserMode};
  }
  async start(task,{signal,onProgress}={}){
    if(!task.sessionId||!task.requestId)throw Error('任务需要 sessionId 和 requestId');safeId(task.requestId);validateTask(task);
    const release=await acquire(`${this.store.root}:request:${task.requestId}`,task.requestId);let record;
    try{
      let request;try{request=await this.store.read('requests',task.requestId);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(request){if(request.digest!==digest(task))throw Error('调用编号已经绑定其他任务');if(request.archived)return{runId:request.runId,status:request.status,archived:true,reason:'completed_checkpoint_expired'};return this.status(request.runId);}
      const session=this.sessions.get(task.sessionId);
      if(task.allowedOrigins.some(o=>!session.record.allowedOrigins.includes(o)))throw Error('任务不能扩大会话允许来源');
      record={runId:randomUUID(),sessionId:task.sessionId,requestId:task.requestId,task,status:'starting',active:false,browserMode:session.record.profileId?'独立受控浏览器':'GPT 侧栏'};
      await this.store.write('runs',record.runId,record);await this.store.write('requests',task.requestId,{runId:record.runId,digest:digest(task)});
    }finally{await release();}
    return this.drive(record,false,{signal,onProgress});
  }
  async continue(runId,options={}){
    const record=await this.store.read('runs',safeId(runId));if(record.status==='verified')return this.summary(record);
    if(record.active&&this.controllers.has(runId))return this.summary(record);
    if(!record.checkpoint){if(record.result?.reason==='TAB_BUSY')return this.drive(record,false,options);throw Error('尚无检查点，不能恢复未知的启动状态');}
    const session=this.sessions.get(record.sessionId);
    if(record.checkpoint.identity!==session.adapter.identity){
      if(!options.reattach)return{...this.summary(record),status:'handoff',reason:'session_reattach_required'};
      const observed=await session.adapter.observe();if(!record.task.allowedOrigins.includes(new URL(observed.url).origin))return{...this.summary(record),status:'handoff',reason:'needs_origin'};
      if(record.checkpoint.pending&&record.checkpoint.pending.phase!=='prepared'){let effect=await session.adapter.check(resolveChecks(record.task.subgoals[record.checkpoint.index].checks,record.checkpoint.data));if(!effect.ok&&record.checkpoint.pending.intent)effect=await session.adapter.checkAction(record.checkpoint.pending.intent);if(!effect.ok)return{...this.summary(record),status:'handoff',reason:'uncertain_action'};}
      record.checkpoint.identity=session.adapter.identity;
    }
    return this.drive(record,true,options);
  }
  async drive(record,continuing,{signal,onProgress}={}){
    const runId=record.runId;if(this.controllers.has(runId))return this.status(runId);
    const session=this.sessions.get(record.sessionId);
    if(this.sessionRuns.has(session.adapter.identity)){record.status='handoff';record.active=false;record.result={reason:'TAB_BUSY'};await this.store.write('runs',runId,record);return this.summary(record);}
    this.sessionRuns.set(session.adapter.identity,runId);
    const controller=new AbortController();this.controllers.set(runId,controller);
    const combined=AbortSignal.any([controller.signal,signal].filter(Boolean));
    const previousTrace=session.adapter.trace,previousOrigins=session.adapter.allowedOrigins;
    let services,trace;
    try{
      trace=this.config.trace?localTrace({enabled:true,filePath:join(this.store.root,'traces',`${runId}-${randomUUID()}.jsonl`)}):undefined;session.adapter.trace=trace;session.adapter.allowedOrigins=record.task.allowedOrigins;
      record.active=true;await this.store.write('runs',runId,record);
      services=await this.services(trace);
      const options={signal:combined,onProgress,runId,trace,saveCheckpoint:async checkpoint=>{record.checkpoint=checkpoint;record.progress={completed:checkpoint.completed,remaining:record.task.subgoals.slice(checkpoint.index).map(s=>({id:s.id,goal:s.goal})),actions:checkpoint.actions.filter(a=>a.phase!=='prepared'&&a.effect!=='not_executed').length,handoffs:checkpoint.handoffs,elapsed_ms:checkpoint.elapsedMs,data:checkpoint.data};if(record.active)record.status='running';const navigation=session.adapter.navigationState?.();if(navigation&&JSON.stringify(navigation)!==JSON.stringify(session.record.navigation)){session.record.navigation=navigation;session.record.lastUrl=checkpoint.lastUrl;await this.store.write('sessions',record.sessionId,session.record);}await this.store.write('runs',runId,record);}};
      const result=continuing?await resume(record.checkpoint,session.adapter,services,options):await run(record.task,session.adapter,services,options);
      record.checkpoint=result.checkpoint;record.result=result;record.status=result.status;record.finishedAt=result.status==='verified'?Date.now():undefined;record.active=false;
      session.record.lastUrl=result.checkpoint.lastUrl||result.url;session.record.navigation=session.adapter.navigationState?.();await this.store.write('sessions',record.sessionId,session.record);
      await this.store.write('runs',runId,record);return this.summary(record);
    }catch(e){record.active=false;record.status='handoff';record.result={reason:e.code||'runtime_error',detail:{message:e.message}};await this.store.write('runs',runId,record);return this.summary(record);}
    finally{this.controllers.delete(runId);this.sessionRuns.delete(session.adapter.identity);session.adapter.trace=previousTrace;session.adapter.allowedOrigins=previousOrigins;trace?.close();if(!this.injectedServices){await services?.close?.();this.serviceSets.delete(services);}}
  }
  async status(runId){return this.summary(await this.store.read('runs',safeId(runId)));}
  async cancel(runId){safeId(runId);const controller=this.controllers.get(runId);if(controller){controller.abort();return{runId,cancellationRequested:true};}const r=await this.store.read('runs',runId);if(r.status==='verified')return{runId,status:'verified',cancellationRequested:false};r.status='cancelled';r.active=false;if(r.checkpoint)r.checkpoint.status='cancelled';await this.store.write('runs',runId,r);return this.summary(r);}
  async act({sessionId,ref,value,authorizedSubmit=false,runId},options={}){
    const s=this.sessions.get(sessionId),action=s.adapter.resolveRef(ref);
    if(action.isSubmit&&!authorizedSubmit)return{status:'handoff',reason:'submit_authorization_required'};
    if(action.frameUrl&&!s.record.allowedOrigins.includes(action.frameOrigin||new URL(action.frameUrl).origin))throw Error('目标 frame 来源未授权');
    if(action.href&&!s.record.allowedOrigins.includes(new URL(action.href,action.documentUrl||s.record.lastUrl).origin))throw Error('目标来源未授权');
    if(['click','press'].includes(action.kind)&&action.formAction&&!s.record.allowedOrigins.includes(new URL(action.formAction).origin))throw Error('表单提交来源未授权');
    const id=randomUUID(),release=await acquire(s.adapter.identity,id);const entry={id,sessionId,runId,kind:action.kind,issued:false,effect:'unknown',startedAt:Date.now()};
    try{
      if(options.signal?.aborted)return{status:'cancelled'};
      if(!(await s.adapter.validate(action)).ok)return{status:'handoff',reason:'target_changed'};
      await this.store.write('supervisor',id,entry);entry.issued=true;await this.store.write('supervisor',id,entry);
      await s.adapter.execute(action,value,{signal:options.signal,alreadyValidated:true});
      entry.effect='issued';entry.finishedAt=Date.now();await this.store.write('supervisor',id,entry);
      return{status:'executed',actionId:id,requiresVerification:true,page:await this.sessions.inspect(sessionId)};
    }catch(e){entry.error=e.message;await this.store.write('supervisor',id,entry);return{status:'handoff',reason:entry.issued?'uncertain_action':'runtime_error',actionId:id};}
    finally{await release();}
  }
  async call(name,args={},options={}){
    if(name==='jev_session'){
      const {action,...rest}=args;
      if(action==='open')return this.sessions.open(rest);if(action==='list')return this.sessions.list();if(action==='inspect'){const owner=this.sessionRuns.get(this.sessions.get(rest.sessionId).adapter.identity);if(owner)return{status:'running',reason:'TAB_BUSY',runId:owner};return this.sessions.inspect(rest.sessionId,rest);}
      if(action==='act')return this.act(rest,options);if(action==='close'){for(const id of this.controllers.keys()){const r=await this.store.read('runs',id);if(r.sessionId===rest.sessionId)throw Error('会话正在执行；先取消并等待动作核对结束');}return this.sessions.close(rest.sessionId);}throw Error('无效会话操作');
    }
    if(name==='jev_run')return this.start(args.task||args,options);
    if(name==='jev_resume')return this.continue(args.runId,options.reattach!==undefined?options:{...options,reattach:args.reattach});
    if(name==='jev_status')return this.status(args.runId);
    if(name==='jev_cancel')return this.cancel(args.runId);
    throw Error('未知工具');
  }
  async close(){for(const c of this.controllers.values())c.abort();if(this.controllers.size)throw Error('动作尚未结束；先取消并等待结果后关闭');clearInterval(this.cleanupTimer);await this.sessions.closeAll();for(const s of this.serviceSets)await s.close?.();}
  async shutdown(){for(const c of this.controllers.values())c.abort();const until=Date.now()+30000;while(this.controllers.size&&Date.now()<until)await new Promise(r=>setTimeout(r,25));if(this.controllers.size)throw Error('动作尚未结束，保留原现场');await this.close();}
}
