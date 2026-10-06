import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Agent} from '../src/agent.mjs';
import {randomUUID} from 'node:crypto';

// Exercises the installed browser adapter against a public website without model credentials.
// This is platform evidence, not a Jev/model or formal host acceptance run.
const home=await mkdtemp(join(tmpdir(),'inspire-platform-'));
const began=performance.now(),agent=await Agent.create({home,host:'platform-ci'});
let session;const report={version:agent.config.version,platform:process.platform,architecture:process.arch,kind:'公开网站适配器冒烟；未调用模型，不计正式验收',passed:false,steps:[]};
async function actionWhere(predicate){
 const active=agent.sessions.get(session.id);
 for(let batch=0;batch<20;batch++){
  const page=await active.adapter.observe(),action=page.actions.find(predicate);
  if(action)return action;
  if(!page.cursor)break;await active.adapter.expand(page);
 }
 throw Error('有限观测未找到业务目标');
}
async function act(predicate){const target=await actionWhere(predicate);const started=performance.now();const result=await agent.call('jev_session',{action:'act',sessionId:session.id,ref:target.ref});assert.equal(result.status,'executed',JSON.stringify(result));report.steps.push({kind:target.kind,ms:Math.round(performance.now()-started)});}
try{
 session=await agent.call('jev_session',{action:'open',url:'https://books.toscrape.com/',allowedOrigins:['https://books.toscrape.com'],headless:true});
 await act(a=>a.kind==='click'&&a.label.trim()==='Poetry');
 const current=agent.sessions.get(session.id);
 await current.page.waitForURL(/\/category\/books\/poetry_/, {timeout:10000});
 const found=await current.adapter.extract([{name:'titles',selector:'article.product_pod h3 a',attribute:'title',all:true,maxItems:30,maxChars:200}]);
 assert.ok(found.data.titles.length>0);report.discoveredBooks=found.data.titles.length;
 await act(a=>a.kind==='click'&&a.href&&/\/catalogue\/[^/]+\/index\.html$/.test(new URL(a.href,current.page.url()).href)&&!a.href.includes('/category/'));
 await current.page.waitForSelector('table.table-striped',{timeout:10000});
 const details=await current.adapter.extract([{name:'title',selector:'h1',maxChars:200},{name:'price',selector:'.price_color',maxChars:100},{name:'metadata',selector:'table.table-striped',maxChars:2000}]);
 assert.ok(details.data.title&&details.data.price&&details.data.metadata);report.detailSource=current.page.url();
 await act(a=>a.kind==='back');await current.page.waitForURL(/\/category\/books\/poetry_/, {timeout:10000});
 report.passed=true;
}catch(e){report.error={code:e.code||e.name,message:e.message};process.exitCode=1;}
finally{if(session)await agent.call('jev_session',{action:'close',sessionId:session.id});await agent.close();report.totalMs=Math.round(performance.now()-began);await mkdir('artifacts',{recursive:true});await writeFile('artifacts/platform-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
