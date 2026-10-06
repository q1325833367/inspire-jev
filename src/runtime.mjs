import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {createTrace} from './trace.mjs';
import {settings} from './config.mjs';
export async function localSettings(){return settings();}
export function localTrace(options={}){const {enabled=false,...rest}=options;if(!enabled)return undefined;return createTrace({filePath:join(tmpdir(),'jev-agent-traces',`${randomUUID()}.jsonl`),...rest});}
