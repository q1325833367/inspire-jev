export type DataReference = {subgoal:string;field:string;index?:number;source?:never;resolveUrl?:boolean} | {subgoal:string;source:'url';field?:never;index?:never;resolveUrl?:boolean};
export interface Check {kind:'url'|'title'|'text'|'exists'|'field'|'checked'|'selected'|'elementText'|'attribute'|'count'|'evidence';equalsFrom?:DataReference;includesFrom?:DataReference;minCount?:number;maxCount?:number;selector?:string;label?:string;labelIncludes?:string;equals?:string|boolean;includes?:string;excludes?:string;notEmpty?:boolean;maxLength?:number;attribute?:string;frame?:string;subgoal?:string;sensitive?:boolean;}
export type StageCheck = Omit<Check,'kind'> & {kind:Exclude<Check['kind'],'evidence'>};
export interface TaskRequest {sessionId:string;requestId:string;goal:string;inputs?:Record<string,string|boolean|number>;allowedOrigins:string[];subgoals:Array<{id:string;goal:string;checks:StageCheck[];value?:string;checked?:boolean;generate?:string;allowSubmit?:boolean;hostOnly?:boolean;sensitive?:boolean;allowedKinds?:string[];extract?:Array<{name:string;source?:'url'|'title'|'section';selector?:string;attribute?:string;all?:boolean;maxItems?:number;maxParagraphs?:number;required?:boolean;maxChars?:number}>}>;completionChecks:Check[];budget?:{maxDurationMs?:number;maxActions?:number;sliceMs?:number};}
export interface RunResult {runId:string;sessionId:string;requestId:string;status:'starting'|'running'|'handoff'|'budget_reached'|'cancelled'|'verified';reason?:string;actions?:number;elapsed_ms?:number;completed?:unknown[];remaining?:unknown[];data?:Record<string,unknown>;proof?:unknown;checkpointId?:string;versions?:Record<string,unknown>;browserMode?:string;}
export interface BrowserAdapter {identity:string;capabilities():Promise<unknown>;observe(options?:unknown):Promise<unknown>;validate(target:unknown):Promise<{ok:boolean}>;execute(target:unknown,value:unknown,options?:{signal?:AbortSignal}):Promise<void>;check(checks:Check[]):Promise<{ok:boolean}>;extract(specs:unknown[]):Promise<unknown>;}
export class Agent {static create(options?:Record<string,unknown>):Promise<Agent>;call(name:string,args?:unknown,options?:{signal?:AbortSignal;onProgress?:(progress:unknown)=>unknown}):Promise<unknown>;start(task:TaskRequest,options?:unknown):Promise<RunResult>;continue(runId:string,options?:unknown):Promise<RunResult>;status(runId:string):Promise<RunResult>;cancel(runId:string):Promise<unknown>;close():Promise<void>;shutdown():Promise<void>;}
export const VERSION:string;

export function run(task:TaskRequest,adapter:BrowserAdapter,services:unknown,options?:unknown):Promise<RunResult>;
export function resume(checkpoint:unknown,adapter:BrowserAdapter,services:unknown,options?:unknown):Promise<RunResult>;
export function validateTask(task:TaskRequest):TaskRequest;
export function loadCheckpoint(runId:string):Promise<unknown>;
export function browserAdapter(tab:unknown,options?:unknown):BrowserAdapter;
export function createServices(config:Record<string,string>,options?:unknown):unknown;
export function loadConfig(envFile:string):Promise<Record<string,string>>;
