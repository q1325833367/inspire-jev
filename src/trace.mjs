import { appendFileSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { trackTrace, resolveTrace, cleanupTraceLogs } from './trace-retention.mjs';

// Local JSONL only. Write START before invoking an operation, including operations
// that never return. Durations use a monotonic clock; timestamps are UTC.
export function createTrace({ filePath, traceId = randomUUID(), onEvent, onError, heartbeatMs = 2000, secrets = [], maxFileBytes = 10*1024*1024, maxDirectoryBytes = 100*1024*1024 } = {}) {
  if (!filePath) throw new Error('追踪需要日志路径');
  if(!Number.isInteger(maxFileBytes)||maxFileBytes<2048)throw new Error('单份日志容量至少 2048 字节');
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const cleanup=cleanupTraceLogs(dirname(filePath),{maxBytes:maxDirectoryBytes});
  appendFileSync(filePath, '', { mode: 0o600 }); chmodSync(filePath, 0o600);
  const scope = new AsyncLocalStorage(), hidden = new Set(secrets.filter(Boolean).map(String));
  let sequence = 0, writeErrors = 0, bytes=statSync(filePath).size, activeSpans=0, closed=false, stopped=cleanup.over_budget;
  trackTrace(filePath,{trace_id:traceId,active:true,created_at:Date.now(),review_status:'unresolved',resolved_at:null,resolution:null,evidence:null,recording:stopped?'stopped':'enabled',max_file_bytes:maxFileBytes,max_directory_bytes:maxDirectoryBytes});
  const redact = value => {
    if (typeof value !== 'string') return value;
    for (const secret of hidden) value = value.split(secret).join('[已脱敏]');
    return value.replace(/\b(?:sk-|apikey_)[a-zA-Z0-9_-]{8,}/g, '[已脱敏]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [已脱敏]')
      .replace(/https?:\/\/[^\s"<>]+/g, raw => {
        try { const u = new URL(raw); return `${u.origin}${u.pathname}${u.search || u.hash ? '?[已脱敏]' : ''}`; }
        catch { return '[网址已脱敏]'; }
      }).slice(0, 1200);
  };
  const sanitize = (value, depth = 0) => {
    if (depth > 5) return '[已截断]';
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.slice(0, 40).map(v => sanitize(v, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([k, v]) => [k, /(?:key|token$|authorization|password|secret|prompt|body|^text$|^value$|^input$|^label$|^selector$)/i.test(k)
        ? '[已脱敏]' : sanitize(v, depth + 1)]));
    return value;
  };
  function emit(event, operation, data = {}, extra = {}) {
    const now = Date.now(), context = scope.getStore() || {};
    const record = { schema_version: 1, trace_id: traceId, seq: ++sequence,
      timestamp: new Date(now).toISOString(), epoch_ms: now,
      ...context, ...extra, event, operation, data: sanitize(data) };
    if(closed||stopped)return record;
    let line=`${JSON.stringify(record)}\n`,length=Buffer.byteLength(line);
    if(bytes+length>maxFileBytes-1024){
      stopped=true;
      Object.assign(record,{event:'limit',operation:'trace.recording.stopped',data:{reason:'file_size_limit',max_file_bytes:maxFileBytes,retained_bytes:bytes}});
      line=`${JSON.stringify(record)}\n`;length=Buffer.byteLength(line);
      try {trackTrace(filePath,{recording:'stopped',stop_reason:'file_size_limit'});}catch(error){writeErrors++;try{onError?.(error);}catch{}}
    }
    try { if(bytes+length<=maxFileBytes){appendFileSync(filePath,line,{mode:0o600});bytes+=length;} }
    catch (error) { writeErrors++; try { onError?.(error); } catch {} }
    try { onEvent?.(record); } catch {} // A viewer must not change execution behavior.
    return record;
  }
  const trace = {
    filePath, traceId,
    get writeErrors() { return writeErrors; },
    get status() {return {recording:stopped?'stopped':closed?'closed':'enabled',bytes,active_spans:activeSpans,write_errors:writeErrors};},
    close() {if(activeSpans)throw new Error('仍有调用运行，不能关闭追踪');closed=true;trackTrace(filePath,{active:false,closed_at:Date.now(),recording:stopped?'stopped':'closed'});},
    resolve(review) {if(!closed)trace.close();return resolveTrace(filePath,review);},
    addSecrets(values) { for (const value of values) if (value !== undefined && value !== null && String(value)) hidden.add(String(value)); },
    ref(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 16); },
    event: emit,
    withContext(context, work) { return scope.run({ ...scope.getStore(), ...context }, work); },
    setContext(context) { Object.assign(scope.getStore() || {}, context); },
    async span(operation, data, work, summarize) {
      const parent = scope.getStore() || {}, spanId = randomUUID(), began = performance.now();
      const context = { ...parent, span_id: spanId, parent_span_id: parent.span_id ?? null };
      for (const key of ['run_id', 'browser_identity', 'subgoal_id', 'action_id']) if (data?.[key] !== undefined) context[key] = data[key];
      return scope.run(context, async () => {
        activeSpans++;
        emit('start', operation, data, { elapsed_ms: 0 });
        const elapsed = () => Math.round((performance.now() - began) * 100) / 100;
        const timer = heartbeatMs > 0 ? setInterval(() => emit('waiting', operation, {}, { elapsed_ms: elapsed() }), heartbeatMs) : null;
        timer?.unref?.();
        try {
          const result = await work();
          let summary = {}; try { summary = summarize?.(result) || {}; } catch {}
          emit('end', operation, summary, { elapsed_ms: elapsed() });
          return result;
        } catch (error) {
          emit('error', operation, { error_name: error?.name, error_code: error?.code, message: error?.message || String(error) }, { elapsed_ms: elapsed() });
          throw error;
        } finally { if (timer) clearInterval(timer);activeSpans--; }
      });
    }
  };
  if(stopped){try{onEvent?.({timestamp:new Date().toISOString(),event:'limit',operation:'trace.recording.stopped',data:{reason:'directory_size_limit',protected_bytes:cleanup.protected_bytes},trace_id:traceId});}catch{}}
  return trace;
}

export const traceStep = (trace, name, data, work, summarize) => trace ? trace.span(name, data, work, summarize) : work();
