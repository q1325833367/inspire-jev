#!/usr/bin/env node
import { traceState, resolveTrace, pinTrace, cleanupTraceLogs } from './trace-retention.mjs';
const [command,path,...args]=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
try{
  let result;
  if(command==='status')result=traceState(path);
  else if(command==='resolve')result=resolveTrace(path,{reason:option('--reason'),evidence:option('--evidence')});
  else if(command==='pin')result=pinTrace(path,!args.includes('--off'));
  else if(command==='cleanup')result=cleanupTraceLogs(path,{dryRun:!args.includes('--apply')});
  else throw Error('用法：trace-admin.mjs status|resolve|pin <日志.jsonl>，或 cleanup <日志目录> [--apply]。resolve 需要 --reason 和 --evidence；cleanup 默认只预览。');
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
