// Host-neutral task runner. Adapters own observation, input and permissions.
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, unlink, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { traceStep } from './trace.mjs';
import {acquire} from './locks.mjs';
import {defaultHome,VERSION} from './config.mjs';
import {secureDirectory} from './platform.mjs';
const writers = new Map();
const copy = value => structuredClone(value);
const storage = join(defaultHome(), 'checkpoints-v2');
function validateReference(ref) {
  const pageUrl=ref?.source==='url';
  if (!ref || typeof ref.subgoal!=='string' || !ref.subgoal.trim() ||
      (pageUrl ? ref.field!==undefined || ref.index!==undefined : ref.source!==undefined || typeof ref.field!=='string' || !ref.field.trim()) ||
      (ref.index!==undefined && (!Number.isInteger(ref.index) || ref.index<0))) {
    throw Object.assign(new Error('阶段数据引用无效：采集字段使用 field（可加 index）；页面地址使用 source:"url"。field 与 source 不能混用，页面地址不能加 index。'),{code:'INVALID_TASK_REFERENCE'});
  }
}
export function resolveChecks(checks,data){return checks.map(c=>{const out={...c};for(const [refKey,key] of [['equalsFrom','equals'],['includesFrom','includes']])if(c[refKey]){const ref=c[refKey];validateReference(ref);const saved=data[ref.subgoal];let value=ref.source==='url'?saved?.url:saved?.data?.[ref.field];if(ref.index!==undefined)value=value?.[ref.index];if(value===undefined||value===null)throw Error('阶段数据缺失，不能核验条件');out[key]=ref.resolveUrl?new URL(String(value),saved.url).href:String(value);delete out[refKey];}return out;});}
export async function loadCheckpoint(runId) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('无效任务编号');
  return JSON.parse(await readFile(join(storage, `${runId}.json`), 'utf8'));
}
export function validateTask(task) {
  if (!task?.goal?.trim() || !Array.isArray(task.subgoals) || !task.subgoals.length ||
      !Array.isArray(task.allowedOrigins) || !task.allowedOrigins.length ||
      !Array.isArray(task.completionChecks) || !task.completionChecks.length) throw new Error('任务缺少目标、子目标、来源或完成条件');
  const ids = new Set();
  for(const c of [...task.subgoals.flatMap(s=>s.checks||[]),...task.completionChecks])for(const key of ['equalsFrom','includesFrom'])if(c[key]!==undefined)validateReference(c[key]);
  for (const step of task.subgoals) {
    if (!step.id || ids.has(step.id) || !step.goal?.trim() || !step.checks?.length) throw new Error('子目标需要唯一编号与独立检查');
    if(step.checks.some(c=>c.kind==='evidence'))throw new Error('阶段 checks 只检查实际页面状态；evidence 只能放在 task.completionChecks，不能作为阶段自身的前置条件');
    for(const c of step.checks)for(const key of ['equalsFrom','includesFrom'])if(c[key]&&!ids.has(c[key].subgoal))throw new Error('阶段数据引用只能指向已经排在前面的阶段，不能引用自身、未来或不存在的阶段');
    for(const spec of step.extract||[])if(spec.source==='section'&&(spec.attribute||spec.all||spec.maxItems))throw new Error('source=section 只读取标题之后的正文段落，不能提取链接或列表；读取元素文本或href时删除source，用inspect观测到的selector并按需设置all、attribute');
    ids.add(step.id);
  }
  const b = { maxDurationMs: 90000, maxActions: 40, sliceMs: 45000, ...task.budget };
  if (!Number.isFinite(b.maxDurationMs) || b.maxDurationMs < 1 || !Number.isInteger(b.maxActions) || b.maxActions < 1 ||
      !Number.isFinite(b.sliceMs) || b.sliceMs < 1 || b.sliceMs > 45000) throw new Error('无效执行预算');
  const thresholds = { operation: 0, target: 0, ...task.thresholds };
  if (Object.values(thresholds).some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('置信度门槛必须在 0 到 1 之间');
  for(const origin of task.allowedOrigins)if(new URL(origin).origin!==origin||!['http:','https:'].includes(new URL(origin).protocol))throw Error('允许来源必须是 HTTP(S) origin');
  for(const c of task.completionChecks)if(c.kind==='evidence'&&!ids.has(c.subgoal))throw Error('证据检查引用未知阶段');
  return { ...task, budget: b, thresholds };
}

function initial(task, identity) {
  return { version: 2, engineVersion:VERSION, runId: randomUUID(), identity, task: copy(task), index: 0, elapsedMs: 0,
    actions: [], decisions: [], textCalls: [], completed: [], data:{}, handoffs: 0, pending: null };
}

export async function run(task, adapter, services, options = {}) {
  task = validateTask(task);
  const state=initial(task,adapter.identity);if(options.runId)state.runId=options.runId;
  return tracedDrive('runner.run',state, adapter, services, options);
}

export async function resume(checkpoint, adapter, services, options = {}) {
  if (checkpoint?.version !== 2 || checkpoint.identity !== adapter.identity) throw new Error('检查点与浏览器现场不匹配；旧 PoC 检查点只读');
  const state = copy(checkpoint);
  validateTask(state.task);
  if (options.resolution) {
    if(state.pending)throw new Error('未知动作须通过实际效果检查，不能用文字声明清除');
  }
  return tracedDrive('runner.resume',state, adapter, services, options);
}

function tracedDrive(operation,state,adapter,services,options) {
  const trace=options.trace ?? adapter.trace ?? services.trace;
  trace?.addSecrets(state.task.subgoals.flatMap(s=>[s.value,...s.checks.filter(c=>c.sensitive).map(c=>c.equals)]).concat(Object.values(state.task.inputs || {})));
  const work=()=>traceStep(trace,operation,{run_id:state.runId,browser_identity:adapter.identity},()=>drive(state,adapter,services,{...options,trace}),r=>({status:r.status,reason:r.reason,actions:r.actions,handoffs:r.handoffs,elapsed_ms:r.elapsed_ms,metrics:r.metrics,trace_write_errors:trace?.writeErrors}));
  return trace?trace.withContext({run_id:state.runId,browser_identity:adapter.identity},work):work();
}

async function drive(state, adapter, services, { signal, onProgress, saveCheckpoint, trace } = {}) {
  const span=(name,data,work,summary)=>traceStep(trace,name,data,work,summary);
  if (!adapter.identity || !services?.decide) throw new Error('缺少适配器身份或决策服务');
  if (writers.has(adapter.identity)) throw new Error('该物理标签页已有写入任务');
  const release = await span('runner.writer.acquire',{},()=>acquire(adapter.identity, state.runId));
  await secureDirectory(storage);
  writers.set(adapter.identity, state.runId);
  const began = performance.now(), { task } = state;
  let page, proof, reason, detail, capabilities;
  const generatedByStep = new Map();
  const clock = () => state.elapsedMs + performance.now() - began;
  const actionCount=()=>state.actions.filter(a=>a.phase!=='prepared'&&a.effect!=='not_executed').length;
  const persist = () => span('runner.checkpoint.save',{action_count:actionCount(),pending_action:state.pending?.id},async () => {
    const value = { ...copy(state), elapsedMs: clock() };
    if (saveCheckpoint) await saveCheckpoint(value);
    else {const path = join(storage, `${state.runId}.json`), temp = `${path}.${randomUUID()}.tmp`;await writeFile(temp, JSON.stringify(value), {mode:0o600}); await rename(temp,path);}
  });
  const result = (status, why, extra) => {
    state.status=status;state.active=false;if(status==='verified')state.finishedAt=Date.now();
    reason = why; detail = extra;
    const checkpoint = { ...copy(state), elapsedMs: Math.round(clock()) };
    trace?.event('result','runner.result',{status,reason:why,action_count:actionCount(),handoffs:state.handoffs});
    return { status, reason, detail, runId: state.runId, browserIdentity: state.identity, traceFile:trace?.filePath,
      elapsed_ms: checkpoint.elapsedMs, completed: copy(state.completed),data:copy(state.data),versions:{engine:VERSION,models:metrics(state).models},
      remaining: task.subgoals.slice(state.index).map(s => ({ id: s.id, goal: s.goal })),
      actions: actionCount(), handoffs: state.handoffs, proof, capabilities,
      url: proof?.url ?? page?.url, metrics: metrics(state), trace: copy(state.actions), checkpoint };
  };
  const handoff = (why, extra) => { state.handoffs++; return result('handoff', why, extra); };
  const bindChecks=checks=>resolveChecks(checks,state.data);
  const checkWithEvidence = async checks => {
    checks=bindChecks(checks);
    const live=checks.filter(c=>c.kind!=='evidence');
    const ev=live.length?await adapter.check(live):{details:[],url:page?.url||state.lastUrl};
    ev.details||=live.map(c=>({kind:c.kind,ok:!!ev.ok}));
    for(const c of checks.filter(c=>c.kind==='evidence')){const found=state.completed.find(s=>s.id===c.subgoal);ev.details.push({kind:'evidence',subgoal:c.subgoal,ok:!!found?.evidence?.ok,source:found?.evidence?.url});}
    ev.ok=ev.details.length>0&&ev.details.every(c=>c.ok);return ev;
  };
  try {
    capabilities = await span('runner.capabilities',{},()=>adapter.capabilities());
    page = await span('runner.observe.initial',{},()=>adapter.observe());
    state.lastUrl=page.url;
    if (!task.allowedOrigins.includes(new URL(page.url).origin)) return handoff('needs_origin', { url: page.url });
    if (state.pending) {
      if(state.pending.phase==='prepared'){const action=state.actions.find(a=>a.id===state.pending.id);action.effect='not_executed';action.phase='not_issued';state.pending=null;}
    }
    if (state.pending) {
      let check = await span('runner.check.pending',{action_id:state.pending.id},()=>adapter.check(bindChecks(task.subgoals[state.index].checks)),r=>({ok:r.ok}));
      if(!check.ok&&adapter.checkAction&&state.pending.intent)check=await adapter.checkAction(state.pending.intent);
      if (!check.ok) return handoff('uncertain_action', { action: state.pending, evidence: check });
      state.actions.find(a => a.id === state.pending.id).effect = 'effect_observed'; state.pending = null;
    }
    let unchanged = 0, stale = 0;
    while (state.index < task.subgoals.length) {
      if (signal?.aborted) return result('cancelled', 'user_cancelled');
      if (clock() >= task.budget.maxDurationMs || actionCount() >= task.budget.maxActions) return result('budget_reached', 'total_budget');
      if (performance.now() - began >= task.budget.sliceMs) return result('running', 'slice_complete');
      const step = {...task.subgoals[state.index],checks:bindChecks(task.subgoals[state.index].checks)};
      trace?.setContext({subgoal_id:step.id});
      const check = await span('runner.check.subgoal',{},()=>adapter.check(step.checks),r=>({ok:r.ok}));
      if (check.ok) {
        if(step.extract?.length&&adapter.extract){const extracted=await adapter.extract(step.extract);state.data[step.id]=extracted;check.extracted=extracted;const missing=step.extract.filter(x=>x.required!==false).filter(x=>{const v=extracted.data[x.name];return v===null||v===undefined||v===''||Array.isArray(v)&&(!v.length||v.some(i=>i===null||i===''));});if(missing.length)return handoff('collection_incomplete',{subgoal:step.id,fields:missing.map(x=>x.name)});}
        state.completed.push({ id: step.id, evidence: check }); state.index++; unchanged = 0;
        await persist(); if(onProgress)await span('runner.progress',{},()=>onProgress({ completed: step.id, remaining: task.subgoals.length - state.index })); continue;
      }
      if (step.hostOnly || step.sensitive || step.checks.some(c=>c.sensitive)) return handoff('host_action_required', { subgoal:step.id });
      const failed=check.details?.filter(d=>!d.ok);
      if(failed?.length && failed.every(d=>['elementText','attribute','field','checked','selected'].includes(d.kind)&&d.count>1)) return handoff('ambiguous_check', {subgoal:step.id,evidence:check});
      page = await span('runner.observe.decision',{},()=>adapter.observe({frame:step.checks.find(c=>c.frame)?.frame}));state.lastUrl=page.url;
      if(page.coverage?.loginForms&&/(?:^|\/)(?:login|signin|sign-in)(?:\/|$)/i.test(new URL(page.url).pathname))return handoff('manual_login_required',{url:page.url});
      if (!task.allowedOrigins.includes(new URL(page.url).origin)) return handoff('needs_origin', { url: page.url });
      const remainingMs = Math.min(task.budget.maxDurationMs - clock(), task.budget.sliceMs - (performance.now() - began));
      if (remainingMs < 10) return result('running', 'slice_complete');
      const localSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.floor(remainingMs)))].filter(Boolean));
      if (step.siteTool) {
        if (!capabilities.siteTools || !adapter.callSiteTool) return handoff('unsupported_site_tool');
        const entry = { id: randomUUID(), subgoal: step.id, kind: 'siteTool', label: step.siteTool.name, effect: 'unknown' };
        state.actions.push(entry); state.pending = { id: entry.id, subgoal: step.id, kind: entry.kind, label: entry.label };
        await persist();
        if (signal?.aborted) return result('cancelled', 'user_cancelled');
        await span('runner.siteTool',{action_id:entry.id},()=>adapter.callSiteTool(step.siteTool.name, step.siteTool.input));
        const outcome = await span('runner.check.outcome',{action_id:entry.id},()=>adapter.check(step.checks),r=>({ok:r.ok}));
        entry.effect = outcome.ok ? 'effect_observed' : 'no_change'; state.pending = null; await persist();
        if (!outcome.ok) return handoff('site_tool_not_verified', { evidence: outcome });
        continue;
      }
      const direct = await span('runner.decision.direct',{},()=>deterministic(step, page.actions,task,check),r=>({matched:Boolean(r),operation:r?.operation,target:r?.target}));
      const decision = direct || await services.decide(modelContext(task,{ page, step: publicStep(step, check),
        recent: state.actions.slice(-4).map(({ kind, label, effect }) => ({ kind, label, effect })) }), localSignal);
      if (!direct) state.decisions.push({ ...decision, action: undefined });
      if (signal?.aborted) return result('cancelled', 'user_cancelled');
      // The page may finish loading while the model is answering.
      if ((['DONE','BLOCKED','WAIT'].includes(decision.operation) || decision.operationConfidence < task.thresholds.operation || decision.targetConfidence < task.thresholds.target) && (await span('runner.check.late_result',{},()=>adapter.check(step.checks),r=>({ok:r.ok}))).ok) continue;
      if (!Number.isFinite(decision.operationConfidence) || decision.operationConfidence < task.thresholds.operation) return handoff('low_operation_confidence', compactDecision(decision));
      if (decision.target && (!Number.isFinite(decision.targetConfidence) || decision.targetConfidence < task.thresholds.target)) return handoff('low_target_confidence', compactDecision(decision));
      if (decision.operation === 'DONE') return handoff('done_not_verified', { evidence: check, decision: compactDecision(decision) });
      if (decision.operation === 'BLOCKED'&&page.cursor&&adapter.expand){await adapter.expand(page);continue;}
      if (decision.operation === 'BLOCKED') return handoff(page.coverage?.truncated || page.coverage?.offscreen > 0 ? 'observation_incomplete' : 'blocked', { coverage: page.coverage, evidence: check });
      let action = page.actions.find(a => a.id === decision.target);
      if (!action) return handoff('invalid_target', compactDecision(decision));
      if(action.kind==='observe'){if(!page.cursor||!adapter.expand)return handoff('observation_incomplete');await adapter.expand(page);continue;}
      if (action.sensitive) return handoff('sensitive_input', { field: action.label });
      if(action.isSubmit&&!step.allowSubmit)return handoff('submit_authorization_required',{target:action.ref,subgoal:step.id});
      if (step.allowedKinds && !step.allowedKinds.includes(action.kind)) return handoff('action_outside_step', compactDecision(decision));
      if(action.frameUrl&&!task.allowedOrigins.includes(action.frameOrigin||new URL(action.frameUrl).origin))return handoff('needs_origin',{url:action.frameUrl});
      if (action.href) {
        const destination = new URL(action.href, page.url);
        if (['http:', 'https:'].includes(destination.protocol) && !task.allowedOrigins.includes(destination.origin)) return handoff('needs_origin', { url: destination.href });
        if (!['http:', 'https:', 'about:'].includes(destination.protocol)) return handoff('unsupported_navigation', { protocol: destination.protocol });
      }
      if(['click','press'].includes(action.kind)&&action.formAction){const destination=new URL(action.formAction);if(!['http:','https:'].includes(destination.protocol)||!task.allowedOrigins.includes(destination.origin))return handoff('needs_origin',{url:destination.href});}
      let value;
      if (action.kind === 'fill') {
        if (step.value !== undefined && !step.sensitive) value = String(step.value);
        else if (Object.hasOwn(task.inputs || {}, action.label)) value = String(task.inputs[action.label]);
        else if (step.generate && services.generate) {
          const context = { instruction: step.generate, field: { label: action.label, role: action.role, value:action.value }, text: page.text.slice(0, 1200) };
          const contextKey = JSON.stringify(context);
          let generated = generatedByStep.get(contextKey);
          if (!generated) {
            generated = await services.generate(context, localSignal);
            generatedByStep.set(contextKey, generated);
            state.textCalls.push({ ...generated, text: undefined });
          }
          value = generated.text;
        } else return handoff('missing_input_value', { field: action.label });
      }
      if (action.kind === 'check') value = step.checked ?? task.inputs?.[action.label] ?? step.checks.find(c=>c.kind==='checked'&&c.label===action.label)?.equals ?? !action.checked;
      trace?.addSecrets([action.kind==='fill'?value:undefined]);
      const fresh = adapter.validate?null:await span('runner.observe.freshness',{},()=>adapter.observe());
      const current = adapter.validate?action:fresh.actions.find(a => a.kind===action.kind && a.selector===action.selector &&
        (a.kind!=='select'||a.value===action.value) && (a.kind!=='scroll'||a.region===action.region&&a.direction===action.direction));
      const targetGuard = a => a && JSON.stringify([a.kind,a.selector,a.label,a.role,a.href,a.value,a.current_value,a.checked,a.context]);
      const inputGuard = p => JSON.stringify(p.actions.filter(a=>['fill','check','select'].includes(a.kind)).map(a=>[a.selector,a.kind,a.value,a.current_value,a.checked]));
      if (adapter.validate?!(await adapter.validate(action)).ok:fresh.url!==page.url || targetGuard(current)!==targetGuard(action) || inputGuard(fresh)!==inputGuard(page)) {
        trace?.event('retry','runner.target.changed',{attempt:stale+1});
        if (++stale >= 3) return handoff('page_unstable', { coverage: fresh?.coverage });
        continue;
      }
      action = current;
      stale = 0;
      if (signal?.aborted) return result('cancelled', 'user_cancelled');
      if (clock() >= task.budget.maxDurationMs || performance.now() - began >= task.budget.sliceMs) return result('running', 'slice_complete');
      const entry = { id: randomUUID(), subgoal: step.id, kind: action.kind, label: action.label,
        phase:'prepared',preparedAt:new Date().toISOString(),effect: 'unknown', decisionSource: direct ? 'deterministic' : 'jev', valueSource: action.kind === 'fill' ? (step.value !== undefined || Object.hasOwn(task.inputs || {},action.label) ? 'provided' : 'generated') : undefined };
      const intent={kind:action.kind,selector:action.selector,href:action.href,label:action.label,documentId:action.documentId,documentUrl:action.documentUrl,frameIndex:action.frameIndex,
        effectUrl:action.kind==='press'?step.checks.find(c=>c.kind==='url'&&c.equals)?.equals:undefined,
        expectedHash:action.kind==='fill'?createHash('sha256').update(String(value)).digest('hex'):undefined,expectedValue:action.kind==='check'?Boolean(value):undefined};
      state.actions.push(entry); state.pending = { id: entry.id, phase:'prepared',subgoal: step.id, kind: action.kind, label: action.label,intent };
      await persist();
      if(localSignal.aborted){entry.effect='not_executed';entry.phase='not_issued';state.pending=null;return result(signal?.aborted?'cancelled':'running',signal?.aborted?'user_cancelled':'slice_complete');}
      entry.phase='dispatching';entry.dispatchedAt=new Date().toISOString();state.pending.phase='dispatching';await persist();
      await span('runner.action.execute',{action_id:entry.id,kind:action.kind,decision_source:entry.decisionSource},()=>adapter.execute(action, value, { signal: localSignal,alreadyValidated:!!adapter.validate }));
      entry.phase='acknowledged';entry.acknowledgedAt=new Date().toISOString();state.pending.phase='acknowledged';
      if (signal?.aborted) return result('cancelled', 'user_cancelled');
      let after = await span('runner.observe.after_action',{action_id:entry.id},()=>adapter.observe());
      let outcome = await span('runner.check.outcome',{action_id:entry.id},()=>adapter.check(step.checks),r=>({ok:r.ok}));
      let effect=outcome.ok?{ok:true}:adapter.checkAction?await adapter.checkAction(intent):{ok:false};
      const awaitsNavigation=action.kind==='click'&&!!action.href||action.kind==='back'||!!intent.effectUrl||action.isSubmit;
      const settleUntil = performance.now() + Math.max(0, Math.min(awaitsNavigation&&!effect.ok?3000:50,
        task.budget.maxDurationMs - clock(), task.budget.sliceMs - (performance.now() - began)));
      while (!outcome.ok && !effect.ok && !signal?.aborted && !['scroll','wait'].includes(action.kind) && performance.now() < settleUntil) {
        await span('runner.settle.wait',{action_id:entry.id},()=>new Promise(resolve => setTimeout(resolve, Math.min(120, settleUntil - performance.now()))));
        if (signal?.aborted) break;
        outcome = await span('runner.check.settled',{action_id:entry.id},()=>adapter.check(step.checks),r=>({ok:r.ok}));
        effect=outcome.ok?{ok:true}:adapter.checkAction?await adapter.checkAction(intent):{ok:false};
      }
      if(awaitsNavigation)after=await adapter.observe();
      entry.effect = outcome.ok||effect.ok ? 'effect_observed' : (awaitsNavigation?'unknown':after.revision !== page.revision ? 'state_changed' : 'no_change');
      trace?.event('effect','runner.action.effect',{effect:entry.effect},{action_id:entry.id});
      page = after;
      state.lastUrl=after.url;
      if(!outcome.ok&&!effect.ok&&awaitsNavigation){await persist();return handoff('uncertain_action',{action:state.pending,evidence:outcome});}
      state.pending = null;
      unchanged = entry.effect === 'no_change' && action.kind!=='wait' ? unchanged + 1 : 0;
      await persist();
      if(onProgress)await onProgress({actions:actionCount(),kind:action.kind,completed:state.completed.length,remaining:task.subgoals.length-state.index,elapsed_ms:Math.round(clock())});
      if (unchanged >= 3) return handoff('no_progress', { evidence: outcome });
    }
    proof = await span('runner.check.original_goal',{},()=>checkWithEvidence(task.completionChecks),r=>({ok:r.ok}));
    if (!proof.ok) return handoff('original_goal_not_verified', { evidence: proof });
    return result('verified');
  } catch (error) {
    trace?.event('error','runner.caught',{error_name:error.name,message:error.message,pending_action:state.pending?.id});
    if(error.notIssued&&state.pending){const action=state.actions.find(a=>a.id===state.pending.id);action.effect='not_executed';action.phase='not_issued';state.pending=null;}
    if (signal?.aborted) return result('cancelled', 'user_cancelled');
    if (state.pending) return handoff('uncertain_action', { action: state.pending, error: error.message,code:error.code });
    if (performance.now() - began >= task.budget.sliceMs && clock() < task.budget.maxDurationMs) return result('running', 'slice_complete');
    return handoff('runtime_error', { error: error.message,code:error.code,category:error.code?.includes('NETWORK')?'network':error.code?.startsWith('MODEL')?'model':'execution' });
  } finally {state.active=false;try { await persist(); } finally { writers.delete(adapter.identity); await span('runner.writer.release',{},release); } }
}

function publicStep(step, evidence) {
  const pendingRequirements = evidence.details
    ? evidence.details.filter(c => !c.ok).map(({kind,label,expected}) => ({kind,label,expected}))
    : step.checks.filter(c => !c.sensitive).map(({kind,label,equals,includes}) => ({kind,label,expected:equals ?? includes}));
  return { id: step.id, goal: step.goal, pendingRequirements, hasValue: step.value !== undefined, checked: step.checked, allowedKinds: step.allowedKinds };
}
function modelContext(task,context){
  const labels=new Set(),secrets=[];
  for(const step of task.subgoals)for(const check of step.checks)if(step.sensitive||step.hostOnly||check.sensitive){if(check.label)labels.add(check.label);for(const value of [step.value,task.inputs?.[check.label],check.equals])if(value!==undefined&&String(value).length>1)secrets.push(String(value),encodeURIComponent(String(value)));}
  const value=copy(context);value.page.actions=value.page.actions.filter(a=>!labels.has(a.kind==='press'?a.label.replace(/ → Enter$/,''):a.kind==='select'?a.label.split(' → ')[0]:a.label));
  const redact=v=>{if(typeof v==='string'){for(const secret of secrets)v=v.split(secret).join('[已隐藏]');return v;}if(Array.isArray(v))return v.map(redact);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,v])=>[k,redact(v)]));return v;};return redact(value);
}
function deterministic(step, actions,task,evidence) {
  if(step.sensitive)return null;
  const destination=step.checks.find(c=>c.kind==='url'&&c.equals&&evidence?.details?.some(d=>d.kind==='url'&&!d.ok&&d.expected===c.equals));
  if(destination){const offered=actions.filter(a=>['click','back'].includes(a.kind)&&a.href&&(!step.allowedKinds||step.allowedKinds.includes(a.kind))).filter(a=>{try{return new URL(a.href,a.documentUrl||destination.equals).href===destination.equals;}catch{return false;}});if(offered.length===1)return{operation:offered[0].kind==='back'?'BACK':'CLICK',target:offered[0].id,operationConfidence:1,targetConfidence:1};}

  for(const c of step.checks){
    if(evidence?.details?.find(d=>d.kind===c.kind&&d.label===c.label)?.ok)continue;
    const value=c.kind==='field'?(step.value??task.inputs?.[c.label]):c.kind==='checked'?(step.checked??task.inputs?.[c.label]??c.equals):c.equals;
    if(value===undefined||!c.label)continue;
    const kind={field:'fill',checked:'check',selected:'select'}[c.kind];if(!kind)continue;
    const targets=actions.filter(a=>a.kind===kind&&!a.sensitive&&a.label===(kind==='select'?`${c.label} → ${value}`:c.label)&&(!step.allowedKinds||step.allowedKinds.includes(kind)));
    if(targets.length===1){const a=targets[0];if(kind==='fill'&&String(a.value)===String(value)||kind==='check'&&a.checked===value)continue;return{operation:{fill:'TYPE_TEXT',check:'CHECK',select:'SELECT'}[kind],target:a.id,operationConfidence:1,targetConfidence:1};}
  }
  if (step.checks.length!==1) return null;
  const check = step.checks.find(c => c.label && ['field', 'checked', 'selected'].includes(c.kind));
  if (!check) return null;
  const options = actions.filter(a => !a.sensitive && (!step.allowedKinds || step.allowedKinds.includes(a.kind)) && (
    check.kind === 'field' && (step.value !== undefined || step.generate) && a.kind === 'fill' && a.label === check.label ||
    check.kind === 'checked' && typeof step.checked === 'boolean' && a.kind === 'check' && a.label === check.label ||
    check.kind === 'selected' && a.kind === 'select' && a.label === `${check.label} → ${check.equals}`));
  if (options.length !== 1) return null;
  const a = options[0];
  return { operation: { fill:'TYPE_TEXT', check:'CHECK', select:'SELECT' }[a.kind], target:a.id, operationConfidence:1, targetConfidence:1 };
}
function compactDecision(d) { return { operation: d.operation, target: d.target, operationConfidence: d.operationConfidence, targetConfidence: d.targetConfidence, candidates: d.candidates }; }
function metrics(s) {
  const sum = (rows, key) => rows.reduce((n, r) => n + (r.usage?.[key] || 0), 0);
  return { decision_calls: s.decisions.length, text_calls: s.textCalls.length,
    models: [...new Set([...s.decisions, ...s.textCalls].map(x => x.model).filter(Boolean))],
    typesafe_input: sum(s.decisions, 'input_tokens'), typesafe_output: sum(s.decisions, 'output_tokens'),
    text_input: sum(s.textCalls, 'prompt_tokens'), text_output: sum(s.textCalls, 'completion_tokens'),
    main_model_tokens: null, total_cost: null };
}
