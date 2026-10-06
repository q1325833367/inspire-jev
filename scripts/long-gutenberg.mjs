import {testEntry,writeReport} from './evidence.mjs';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {verifyGutenbergDetails} from './business-verifiers.mjs';
const count=27,origin='https://www.gutenberg.org',subgoals=[{id:'discover',goal:'点击 Frequently Downloaded，打开下载榜单，发现昨天榜单前 27 本书',checks:[{kind:'url',includes:'/browse/scores/top'},{kind:'exists',selector:'#books-last1 + ol li:nth-child(27)'}],extract:[{name:'titles',selector:'#books-last1 + ol li a',all:true,maxItems:count},{name:'links',selector:'#books-last1 + ol li a',attribute:'href',all:true,maxItems:count}]}];
const formats='#download a.read-online-button,#download a.featured-format-link,#download a.other-format-link';
for(let i=0;i<count;i++){
  subgoals.push({id:`detail-${i+1}`,goal:`从昨天下载榜单打开第 ${i+1} 本书；目标 URL 以 pendingRequirements 为准。核查该书详情和可用阅读格式，不替换书目。`,checks:[{kind:'url',equalsFrom:{subgoal:'discover',field:'links',index:i,resolveUrl:true}},{kind:'exists',selector:'table.bibrec'},{kind:'elementText',selector:'h1',notEmpty:true}],extract:[{name:'title',selector:'h1'},{name:'metadata',selector:'table.bibrec tr',all:true,maxItems:30,maxChars:1000},{name:'formatLabels',selector:formats,all:true,maxItems:40,required:false},{name:'formatLinks',selector:formats,attribute:'href',all:true,maxItems:40,required:false}]});
  subgoals.push({id:`return-${i+1}`,goal:'返回浏览器上一页的下载榜单，以便核查下一本；不要打开其他榜单或更换书目。',allowedKinds:['back'],checks:[{kind:'url',equalsFrom:{subgoal:'discover',source:'url'}}]});
}
const protocol={name:'真实 Gutenberg 27 本详情与可用格式长任务',revision:2,kind:'development-protocol-not-formal-release',minimumActions:55,bookCount:count,subgoals,completionChecks:subgoals.map(s=>({kind:'evidence',subgoal:s.id})),missingFormats:'记录缺项，不替换书目；不要求每本均存在纯文字格式',oldPocStrictReading:'保持封存，不改变旧成绩'};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/long-protocol.json',JSON.stringify(protocol,null,2));const protocolHash=createHash('sha256').update(JSON.stringify(protocol)).digest('hex');
const transport=new StdioClientTransport({command:process.execPath,args:[testEntry(),'mcp','--host','long-development','--trace'],stderr:'pipe'});transport.stderr?.on('data',d=>process.stderr.write(d));const client=new Client({name:'jev-long-real-site',version:'1'}),began=performance.now();
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent||JSON.parse(r.content[0].text);};let session;
try{
  await client.connect(transport);session=await call('jev_session',{action:'open',url:origin+'/',allowedOrigins:[origin],headless:true,label:'真实网站 50 步以上长任务'});
  const task={sessionId:session.id,requestId:randomUUID(),goal:protocol.name+'；原现场发现前27本逐一核查、保存来源；缺项明确记录。',allowedOrigins:[origin],subgoals,completionChecks:protocol.completionChecks,budget:{maxDurationMs:900000,maxActions:200,sliceMs:45000}};
  let result=await call('jev_run',{task});console.log(JSON.stringify({status:result.status,actions:result.actions,completed:result.completed?.length,reason:result.reason}));
  while(result.status==='running'){result=await call('jev_resume',{runId:result.runId});console.log(JSON.stringify({status:result.status,actions:result.actions,completed:result.completed?.length,reason:result.reason}));}
  const discovered=result.data?.discover,books=[];
  for(let i=0;i<count;i++){const d=result.data?.[`detail-${i+1}`];books.push({position:i+1,expectedUrl:discovered?.data.links[i]?new URL(discovered.data.links[i],discovered.url).href:null,url:d?.url,title:d?.data.title,metadataRows:d?.data.metadata?.length||0,formatStatus:d?.data.formatLinks?.length?'已发现':'缺项：未发现阅读格式链接',formats:d?.data.formatLinks?.map((href,index)=>({href,label:d.data.formatLabels[index]||null}))||[],observedAt:d?.observedAt});}
  const checked=verifyGutenbergDetails(result,{count,firstIndex:1,matchTitles:false});
  const independent={books:books.length,allFound:books.every(b=>b.url&&b.url===b.expectedUrl&&b.title&&b.metadataRows>0),sourceAndFormats:checked.passed,returnedToOriginalRanking:result.url===discovered?.url,uniqueUrls:new Set(books.map(b=>b.url)).size===count,minimumActions:result.actions>=protocol.minimumActions,completedStages:result.completed?.length===subgoals.length,noPendingRequirements:result.remaining?.length===0};
  const passed=result.status==='verified'&&Object.values(independent).every(v=>typeof v==='number'||v===true);
  const report={at:new Date().toISOString(),kind:'真实 MCP 长任务开发验证；不是 GPT/Pi 主模型正式验收',protocolHash,passed,independent,result,total_ms:Math.round(performance.now()-began),books,tunOffVerified:false};
  await writeReport('long-gutenberg.json',report);console.log(JSON.stringify({passed,independent,status:result.status,actions:result.actions,elapsed_ms:result.elapsed_ms,total_ms:report.total_ms,metrics:result.metrics,reason:result.reason,detail:result.detail}));if(!passed)process.exitCode=1;
}finally{if(session)await call('jev_session',{action:'close',sessionId:session.id}).catch(()=>{});await client.close();}
