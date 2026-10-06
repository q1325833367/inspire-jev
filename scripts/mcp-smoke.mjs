import {testEntry,writeReport} from './evidence.mjs';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {VERSION} from '../src/config.mjs';
const transport=new StdioClientTransport({command:process.execPath,args:[testEntry(),'mcp','--host','mcp-smoke'],stderr:'pipe'});
transport.stderr?.on('data',chunk=>process.stderr.write(chunk));
const client=new Client({name:'jev-real-smoke',version:'1.0.0'});
const progress=[];
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args},{onprogress:p=>progress.push({name,progress:p.progress,message:p.message})});if(r.isError)throw Error(r.content[0].text);return r.structuredContent||JSON.parse(r.content[0].text);};
let session;
try{
  await client.connect(transport);const listed=await client.listTools();console.log(JSON.stringify({tools:listed.tools.map(t=>t.name)}));
  const version=await client.readResource({uri:'jev://version'});await client.listResourceTemplates();
  session=await call('jev_session',{action:'open',url:'https://www.gutenberg.org/',allowedOrigins:['https://www.gutenberg.org'],headless:true,label:'真实 Gutenberg MCP 冒烟'});
  const page=await call('jev_session',{action:'inspect',sessionId:session.id});console.log(JSON.stringify({url:page.page.url,candidates:page.page.actions.length,coverage:page.page.coverage}));
  const input=page.page.actions.find(a=>a.kind==='fill');if(!input)throw Error('搜索输入未在实际候选发现');
  const task={sessionId:session.id,requestId:randomUUID(),goal:'在 Gutenberg 搜索 Charles Dickens，并采集搜索结果标题和链接',allowedOrigins:['https://www.gutenberg.org'],inputs:{[input.label]:'Charles Dickens'},subgoals:[
    {id:'author',goal:'填写作者搜索词 Charles Dickens',checks:[{kind:'field',label:input.label,equals:'Charles Dickens'}]},
    {id:'results',goal:'提交搜索，打开 Charles Dickens 的搜索结果页',allowedKinds:['press','click','wait','observe'],checks:[{kind:'url',includes:'/ebooks/search/'},{kind:'text',includes:'Dickens',selector:'body'}],extract:[{name:'title',source:'title'},{name:'books',selector:'.booklink .title',all:true,maxItems:3},{name:'links',selector:'.booklink a.link',attribute:'href',all:true,maxItems:3}]}
  ],completionChecks:[{kind:'evidence',subgoal:'author'},{kind:'evidence',subgoal:'results'}]};
  // Observe is discovery, not an externally supplied executable kind restriction.
  task.subgoals[1].allowedKinds=['press','click','wait'];
  let result=await call('jev_run',{task});console.log(JSON.stringify({runId:result.runId,status:result.status,actions:result.actions,elapsed_ms:result.elapsed_ms,reason:result.reason}));
  while(result.status==='running')result=await call('jev_resume',{runId:result.runId});
  const duplicate=await call('jev_run',{task});if(duplicate.runId!==result.runId)throw Error('幂等调用创建了不同任务');
  const status=await call('jev_status',{runId:result.runId});
  if(!progress.length)throw Error('未收到 MCP 原生进度事件');
  const evidence={at:new Date().toISOString(),kind:'development-smoke',version:VERSION,resource:JSON.parse(version.contents[0].text),progress,tools:listed.tools.map(t=>t.name),result,status,idempotent:true,tunOffVerified:false};
  await mkdir('artifacts',{recursive:true});await writeReport('mcp-smoke.json',evidence);
  if(result.status!=='verified')process.exitCode=1;
}finally{if(session)await call('jev_session',{action:'close',sessionId:session.id}).catch(()=>{});await client.close();}
