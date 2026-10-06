import spawn from 'cross-spawn';
import {createInterface} from 'node:readline';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ledger,hash,json} from './acceptance-evidence.mjs';

const resultOf=result=>{if(result?.details?.result)return result.details.result;if(result?.structuredContent)return result.structuredContent;for(const part of result?.content||[])if(part.type==='text'){try{return JSON.parse(part.text);}catch{}}return null;};
function finalOf(text){try{const parsed=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));return{completed:typeof parsed.completed==='boolean'?parsed.completed:null,ranking:parsed.ranking,results:parsed.results};}catch{return{completed:null};}}

// Keeps native tool provenance and usage, while discarding prompts, input values and reasoning.
export function normalizeNative(entry,event,state){
 const rows=[];if(entry==='codex-cli'){
  if(event.type==='thread.started')rows.push({type:'native_thread',backend:'codex-cli',threadId:event.thread_id});
  const i=event.item;
  if(i?.type==='mcp_tool_call'&&event.type==='item.completed'){const result=resultOf(i.result);rows.push({type:'native_tool',callId:i.id,name:i.tool,server:i.server,argsHash:hash(i.arguments),resultHash:result?hash(result):null,status:i.status});}
  if(i?.type==='command_execution'&&event.type==='item.completed')rows.push({type:'native_builtin',name:'exec',status:i.status});
  if(i?.type==='agent_message'&&event.type==='item.completed')state.final=finalOf(i.text);
  if(event.type==='turn.completed')rows.push({type:'native_usage',usage:event.usage});
 }else if(entry==='pi'){
  if(event.type==='session')rows.push({type:'native_thread',backend:'pi',threadId:event.id});
  if(event.type==='tool_execution_start')state.calls.set(event.toolCallId,{name:event.toolName,argsHash:hash(event.args)});
  if(event.type==='tool_execution_end'){const call=state.calls.get(event.toolCallId),result=resultOf(event.result);rows.push({type:'native_tool',callId:event.toolCallId,...call,resultHash:result?hash(result):null,status:event.isError?'error':'completed'});}
  if(event.type==='message_end'&&event.message?.role==='assistant'){
   const m=event.message;rows.push({type:'native_model',provider:m.provider,model:m.model,usage:m.usage,stopReason:m.stopReason});
   const text=m.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');if(m.stopReason!=='toolUse')state.final=finalOf(text);
  }
 }else if(entry==='gpt'){
  const item=event.type==='event_msg'&&event.payload?.type==='item_completed'?event.payload.item:null;
  if(item?.type==='McpToolCall'){const result=resultOf(item.result);rows.push({type:'native_tool',callId:item.id,name:item.tool,server:item.server,argsHash:hash(item.arguments),resultHash:result?hash(result):null,status:item.status,duration:item.duration});}
  if(item?.type==='CommandExecution')rows.push({type:'native_builtin',name:'exec',status:item.status});
  if(item?.type==='AgentMessage'&&item.phase==='final_answer')state.final=finalOf(item.content.filter(c=>c.type==='Text').map(c=>c.text).join('\n'));
  if(event.type==='event_msg'&&event.payload?.type==='token_count')rows.push({type:'native_usage',usage:event.payload.info?.total_token_usage});
  if(event.type==='turn_context')rows.push({type:'native_model',model:event.payload?.model,reasoning:event.payload?.effort,backend:'desktop'});
  if(event.type==='response_item'&&event.payload?.type==='function_call'){let args;try{args=JSON.parse(event.payload.arguments);}catch{}state.calls.set(event.payload.call_id,{name:event.payload.name,argsHash:args?hash(args):null});}
  if(event.type==='response_item'&&event.payload?.type==='function_call_output'&&state.calls.has(event.payload.call_id)){
   const call=state.calls.get(event.payload.call_id);let output;try{output=JSON.parse(event.payload.output);}catch{}const result=resultOf(output)||output;rows.push({type:'native_tool',callId:event.payload.call_id,...call,resultHash:result?hash(result):null,status:'completed'});
  }
  if(event.type==='response_item'&&event.payload?.type==='message'&&event.payload.role==='assistant'&&event.payload.phase==='final_answer')state.final=finalOf(event.payload.content.map(c=>c.text||'').join('\n'));
 }
 return rows;
}

export async function runNative(job,settings){
 if(job.entry==='gpt')return{status:'queued',reason:'desktop_dispatch',jobId:job.id,promptPath:job.promptPath};
 const emit=await ledger(join(job.directory,'native.jsonl')),state={calls:new Map(),final:null};
 const args=job.entry==='pi'?['--provider',settings.provider,'--model',settings.model,'--thinking',settings.reasoning||'high','--mode','json','--print','--no-session','--no-context-files','--no-extensions','--extension',settings.extension,'--skill',settings.skill]:['exec','--json','--ephemeral','--skip-git-repo-check','--model',settings.model,'--cd',job.directory,...(settings.args||[]),'-'];
 const child=spawn(settings.command,[...(settings.commandArgs||[]),...args],{cwd:job.directory,env:{...process.env,...settings.env,INSPIRE_JEV_TEST_OBSERVER:settings.observer,INSPIRE_JEV_ACCEPTANCE_CONTEXT:job.contextPath},stdio:['pipe','pipe','pipe']});
 await emit({type:'native_start',backend:job.entry,jobId:job.id,model:settings.model,provider:settings.provider,reasoning:settings.reasoning,nativeToolsAvailable:settings.nativeToolsAvailable===true,commandVersion:settings.commandVersion});
 child.stdin.end(await readFile(job.promptPath));let writes=Promise.resolve();const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{let event;try{event=JSON.parse(line);}catch{return;}for(const row of normalizeNative(job.entry,event,state))writes=writes.then(()=>emit(row));});
 let diagnosticBytes=0;child.stderr.on('data',chunk=>{diagnosticBytes+=chunk.length;});
 let grace;const timeout=setTimeout(async()=>{await writeFile(join(job.directory,'cancel.request'),'host timeout\n',{flag:'wx',mode:0o600}).catch(()=>{});await emit({type:'host_timeout',cancellationRequested:true});grace=setTimeout(()=>child.kill('SIGINT'),90000);grace.unref();},job.long?1800000:300000);timeout.unref();
 const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timeout);clearTimeout(grace);await writes;
 if(job.caseId==='github-private-draft'&&state.final)delete state.final.results;
 await emit({type:'native_final',...state.final});await emit({type:'native_end',exitCode,diagnosticBytes});return{status:exitCode===0?'finished':'failed',jobId:job.id,exitCode};
}

export async function ingestDesktop(job,path,{startedAt,completedAt,durationMs,nativeToolsAvailable}={}){
 const emit=await ledger(join(job.directory,'native.jsonl')),state={calls:new Map(),final:null};
 const source=await readFile(path,'utf8'),raw=source.split('\n').filter(Boolean).map(JSON.parse);
 const start=raw.find(e=>e.type==='event_msg'&&e.payload?.type==='task_started'),end=raw.findLast(e=>e.type==='event_msg'&&['task_complete','task_completed'].includes(e.payload?.type));
 startedAt=Date.parse(start?.timestamp)||startedAt;completedAt=Date.parse(end?.timestamp)||completedAt;durationMs=end?.payload?.duration_ms||durationMs;
 if(!Number.isFinite(durationMs)||durationMs<=0)throw Error('桌面原生单调时钟耗时缺失');
 await emit({type:'native_start',backend:'desktop',jobId:job.id,startedAt,nativeToolsAvailable:nativeToolsAvailable===true});
 for(const line of (await readFile(path,'utf8')).split('\n').filter(Boolean)){let event;try{event=JSON.parse(line);}catch{continue;}for(const row of normalizeNative('gpt',event,state))await emit(row);}
 if(job.caseId==='github-private-draft'&&state.final)delete state.final.results;
 await emit({type:'native_final',...state.final});await emit({type:'native_end',startedAt,completedAt,durationMs,exitCode:0,sourceSHA256:hash(await readFile(path))});
}
