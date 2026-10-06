import {testEntry,writeReport} from './evidence.mjs';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {publicCases,makeTask} from './public-cases.mjs';
const client=new Client({name:'jev-public-development',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[testEntry(),'mcp','--host','public-development'],stderr:'pipe'}),records=[];
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent||JSON.parse(r.content[0].text);};
await client.connect(transport);
try{
 for(const scenario of publicCases){let session;const began=performance.now();try{
  session=await call('jev_session',{action:'open',url:scenario.url,allowedOrigins:[new URL(scenario.url).origin],headless:true,label:'真实公开网站开发验证'});
  let result=await call('jev_run',{task:makeTask(scenario,session.id,randomUUID())});while(result.status==='running')result=await call('jev_resume',{runId:result.runId});
  const computed=result.status==='verified'&&scenario.postprocess?scenario.postprocess(result):undefined;
  const independent=result.status==='verified'&&scenario.verify(result)&&(!computed||computed.every((row,i)=>Number.isFinite(row.downloads)&&(!i||computed[i-1].downloads>=row.downloads)));
  records.push({id:scenario.id,status:result.status,independent,result,computed,total_ms:Math.round(performance.now()-began)});console.log(JSON.stringify({id:scenario.id,status:result.status,independent,reason:result.reason,actions:result.actions,total_ms:records.at(-1).total_ms}));
 }catch(e){records.push({id:scenario.id,error:e.message,total_ms:Math.round(performance.now()-began)});console.log(JSON.stringify({id:scenario.id,error:e.message}));}finally{if(session)await call('jev_session',{action:'close',sessionId:session.id}).catch(()=>{});}}
 await mkdir('artifacts',{recursive:true});await writeReport('public-smoke.json',{at:new Date().toISOString(),kind:'开发集：真实 MCP 公开网站；不计入正式54次验收',records});if(records.some(r=>!r.independent))process.exitCode=1;
}finally{await client.close();}
