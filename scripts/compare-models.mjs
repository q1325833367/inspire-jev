// 真实网页开发对照；不计入原生宿主发布验收。
import {Agent,createServices,loadConfig} from '../src/index.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const args=process.argv.slice(2),flag=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];},out=resolve(flag('out')||'artifacts/model-comparison'),envFile=flag('env-file');
if(!envFile)throw Error('需要 --env-file 仓库外私密配置路径');
await mkdir(out,{recursive:true});
const config=await loadConfig(envFile),proxy=flag('proxy')||null;
const runtimeMetadata={laya:await fetch('http://127.0.0.1:8769/health').then(r=>r.json()),kev:await fetch('http://127.0.0.1:8770/v1/models').then(r=>r.json()),semif:await fetch('http://127.0.0.1:8772/health').then(r=>r.json())};
const variants={cloud:{...config,JEV_PROVIDER:'typesafe'},laya:{...config,JEV_PROVIDER:'local',LOCAL_JEV_ENGINE:'laya',LOCAL_JEV_BASE_URL:'http://127.0.0.1:8769/v1/systemone',LOCAL_JEV_MODEL:'multilingual'},kev:{...config,JEV_PROVIDER:'local',LOCAL_JEV_ENGINE:'kev',LOCAL_JEV_BASE_URL:'http://127.0.0.1:8770/v1/systemone',LOCAL_JEV_MODEL:'kev-latest'},semif:{...config,JEV_PROVIDER:'local',LOCAL_JEV_ENGINE:'semif',LOCAL_JEV_BASE_URL:'http://127.0.0.1:8772/v1/systemone',LOCAL_JEV_MODEL:'semif-local'}};
const cases=[
 {id:'gutenberg-ranking',url:'https://www.gutenberg.org/',goal:'打开 Frequently Downloaded 下载榜单，采集昨天榜单前三本书标题与链接',target:'/browse/scores/top',checks:[{kind:'url',includes:'/browse/scores/top'},{kind:'exists',selector:'#books-last1 + ol li:nth-child(3)'}],extract:[{name:'titles',selector:'#books-last1 + ol li a',all:true,maxItems:3},{name:'links',selector:'#books-last1 + ol li a',attribute:'href',all:true,maxItems:3}],verify:r=>r.data?.open?.data.titles.length===3&&r.data.open.data.links.every(x=>/^\/ebooks\/\d+$/.test(x))},
 {id:'books-travel',url:'https://books.toscrape.com/',goal:'打开 Travel 分类，读取前三本书的名称、价格和分类来源',target:'travel_2/index.html',checks:[{kind:'url',includes:'/travel_2/index.html'},{kind:'count',selector:'.product_pod',minCount:3}],extract:[{name:'titles',selector:'.product_pod h3 a',attribute:'title',all:true,maxItems:3},{name:'prices',selector:'.product_pod .price_color',all:true,maxItems:3}],verify:r=>r.data?.open?.data.titles.length===3&&r.data.open.data.prices.length===3&&r.data.open.data.prices.every(x=>/^£\d+\.\d{2}$/.test(x))},
 {id:'wiki-section',url:'https://en.wikipedia.org/wiki/Alan_Turing',goal:'通过目录点击 Death 章节，采集章节标题和第一段',target:'#Death',checks:[{kind:'url',includes:'#Death'},{kind:'elementText',selector:'#Death',equals:'Death'}],extract:[{name:'heading',selector:'#Death'},{name:'paragraph',source:'section',selector:'#Death',maxParagraphs:1,maxChars:3000}],verify:r=>r.data?.open?.data.heading==='Death'&&r.data.open.data.paragraph?.trim()&&r.data.open.coverage.paragraph.truncated===false}
];
const contexts=flag('contexts')?JSON.parse(await readFile(resolve(flag('contexts')),'utf8')):[],records=[],runs=[];
const capture=await Agent.create({home:join(out,'private-state'),host:'capture',browserProxy:proxy,envFile});
try{
 for(const c of contexts.length?[]:cases){const s=await capture.sessions.open({url:c.url,allowedOrigins:[new URL(c.url).origin],headless:true});try{
  let found=false;
  for(let batch=0;batch<8&&!found;batch++){
   const page=await capture.sessions.get(s.id).adapter.observe({limits:{maxCandidates:36,maxText:1200}});
   const matching=page.actions.filter(a=>a.kind==='click'&&a.href?.includes(c.target));
   if(matching.length){contexts.push({id:c.id,context:{page,step:{id:'open',goal:c.goal},recent:[]},gold:{operation:'CLICK',targets:matching.map(a=>a.id)}});found=true;}
   else if(page.cursor)await capture.sessions.get(s.id).adapter.expand(page);else break;
  }
  if(!found)throw Error('实际观测未覆盖目标：'+c.id);
 }finally{await capture.sessions.close(s.id);}}
}finally{await capture.close();}
const frozen=JSON.stringify(contexts);await writeFile(join(out,'private-contexts.json'),frozen,{mode:0o600});
const protocol={kind:'SDK/执行核心开发对照，非主 Agent 端到端性能',at:new Date().toISOString(),runtimeMetadata,observationLimits:{maxCandidates:36,maxText:1200},contextSha256:createHash('sha256').update(frozen).digest('hex'),cases:contexts.map(c=>({id:c.id,url:c.context.page.url,candidates:c.context.page.actions.length,coverage:c.context.page.coverage,gold:c.gold})),repeats:3,order:'每次重复轮转 cloud/laya/kev/semif；保留全部失败',taskBudget:{totalMs:90000,maxActions:40,sliceMs:45000}};
await writeFile(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
const save=()=>writeFile(join(out,'results.json'),JSON.stringify({protocol,records,runs},null,2));
for(let repeat=0;repeat<3;repeat++)for(const c of contexts){const order=Object.keys(variants);order.push(...order.splice(0,repeat));for(const name of order){const services=createServices(variants[name],{proxy}),began=performance.now();let record;
 try{const result=await services.decide(c.context,AbortSignal.timeout(30000));record={case:c.id,repeat:repeat+1,model:name,ms:performance.now()-began,passed:result.operation===c.gold.operation&&c.gold.targets.includes(result.target),result};}
 catch(e){record={case:c.id,repeat:repeat+1,model:name,ms:performance.now()-began,passed:false,error:{code:e.code||e.name,provider:e.provider,message:e.message}};}
 finally{await services.close();}
 records.push(record);await save();console.log(JSON.stringify({kind:'decision',...record,result:record.result?{operation:record.result.operation,target:record.result.target,model:record.result.model,usage:record.result.usage}:undefined}));
}}
for(let repeat=0;repeat<3;repeat++)for(const c of cases){const order=Object.keys(variants);order.push(...order.splice(0,repeat));for(const name of order){
 const services={...createServices(variants[name],{proxy}),observationLimits:protocol.observationLimits},agent=await Agent.create({home:join(out,'private-state'),host:'flow-'+name,browserProxy:proxy,services}),began=performance.now();let session,record;
 try{session=await agent.sessions.open({url:c.url,allowedOrigins:[new URL(c.url).origin],headless:true});
  const start=performance.now();let result=await agent.start({sessionId:session.id,requestId:randomUUID(),goal:c.goal,allowedOrigins:[new URL(c.url).origin],subgoals:[{id:'open',goal:c.goal,checks:c.checks,extract:c.extract}],completionChecks:[{kind:'evidence',subgoal:'open'}]});
  while(result.status==='running')result=await agent.continue(result.runId);
  const state=await agent.sessions.get(session.id).adapter.check(c.checks);
  record={case:c.id,repeat:repeat+1,model:name,ms:performance.now()-start,includingOpenMs:performance.now()-began,passed:result.status==='verified'&&!!c.verify(result)&&state.ok,result};
 }catch(e){record={case:c.id,repeat:repeat+1,model:name,ms:performance.now()-began,passed:false,error:{code:e.code||e.name,message:e.message}};}
 finally{await agent.close();await services.close();}
 runs.push(record);await save();console.log(JSON.stringify({kind:'flow',case:c.id,repeat:repeat+1,model:name,ms:record.ms,passed:record.passed,status:record.result?.status,reason:record.result?.reason,error:record.error}));
}}
const median=values=>{const x=[...values].sort((a,b)=>a-b);return x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2;};
const summary=Object.fromEntries(Object.keys(variants).map(model=>[model,{decision:{passed:records.filter(r=>r.model===model&&r.passed).length,total:records.filter(r=>r.model===model).length,medianMs:median(records.filter(r=>r.model===model).map(r=>r.ms))},flow:{passed:runs.filter(r=>r.model===model&&r.passed).length,total:runs.filter(r=>r.model===model).length,medianMs:median(runs.filter(r=>r.model===model).map(r=>r.ms))}}]));
await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
