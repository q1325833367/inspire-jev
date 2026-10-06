import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createServices} from '../src/providers.mjs';
import {readCredentials,publicCredentials} from '../src/credentials.mjs';
const context={page:{url:'https://example.org/',title:'公开页面',text:'点击搜索',actions:[{id:'e1',kind:'click',label:'搜索'}]},step:{id:'search',goal:'点击搜索'},recent:[]};
async function server(handler){const s=createServer(handler);s.listen(0,'127.0.0.1');await once(s,'listening');return{url:`http://127.0.0.1:${s.address().port}/v1/systemone`,close:()=>new Promise(resolve=>s.close(resolve))};}
const answer=(choice,probabilities)=>({choice,confidence:probabilities[choice],probabilities});
test('旧配置继续默认云端；本地不要求云端 key，所有 key 脱敏',async()=>{
 await assert.rejects(readCredentials(undefined,{environment:{}}),{code:'MISSING_TYPESAFE_KEY'});
 const local=await readCredentials(undefined,{environment:{JEV_PROVIDER:'local',LOCAL_JEV_API_KEY:'local-fixture',TYPESAFE_API_KEY:'cloud-fixture'}});
 assert.equal(local.LOCAL_JEV_ENGINE,'laya');assert.ok(!JSON.stringify(publicCredentials(local)).includes('-fixture'));
 await assert.rejects(readCredentials(undefined,{environment:{JEV_PROVIDER:'local',LOCAL_JEV_ENGINE:'unknown'}}),/LOCAL_JEV_ENGINE/);
});
test('本地请求绕过模型代理，禁止发送云端 key，保持全部动态候选',async()=>{
 let captured;const s=await server(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;captured={headers:req.headers,body:JSON.parse(body)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'local-fixture',answers:{operation:answer('CLICK',{DONE:0,BLOCKED:0,CLICK:1}),click_target:answer('e1',{e1:1})}}));});
 const services=createServices({JEV_PROVIDER:'local',LOCAL_JEV_BASE_URL:s.url,TYPESAFE_API_KEY:'cloud-fixture'},{proxy:'http://127.0.0.1:1'});
 try{const result=await services.decide(context);assert.equal(result.target,'e1');assert.equal(result.provider,'local');assert.equal(captured.headers.authorization,undefined);assert.equal(captured.body.max_len,8192);assert.deepEqual(Object.keys(captured.body.questions.click_target.criteria),['e1']);assert.ok(!JSON.stringify(captured).includes('cloud-fixture'));}
 finally{await services.close();await s.close();}
});
test('本地鉴权仅发送本地 key；截断响应不会变成可执行决策',async()=>{
 let auth;const s=await server((req,res)=>{auth=req.headers.authorization;req.resume();res.end(JSON.stringify({model:'local-fixture',usage:{truncated:true},answers:{operation:answer('CLICK',{DONE:0,BLOCKED:0,CLICK:1}),click_target:answer('e1',{e1:1})}}));});
 const services=createServices({JEV_PROVIDER:'local',LOCAL_JEV_API_KEY:'local-fixture',LOCAL_JEV_BASE_URL:s.url});
 try{await assert.rejects(services.decide(context),{code:'MODEL_CONTEXT_INCOMPLETE',provider:'local'});assert.equal(auth,'Bearer local-fixture');}finally{await services.close();await s.close();}
});
test('本地无效目标和服务故障不切换云端',async()=>{
 let cloudCalls=0;const cloud=await server((req,res)=>{cloudCalls++;req.resume();res.end('{}');});
 const local=await server((req,res)=>{req.resume();res.end(JSON.stringify({answers:{operation:answer('CLICK',{DONE:0,BLOCKED:0,CLICK:1}),click_target:answer('invented',{invented:1})}}));});
 const config={JEV_PROVIDER:'local',LOCAL_JEV_ENGINE:'kev',LOCAL_JEV_MODEL:'kev-latest',LOCAL_JEV_BASE_URL:local.url,TYPESAFE_BASE_URL:cloud.url,TYPESAFE_API_KEY:'cloud-fixture'};
 let services=createServices(config);
 try{await assert.rejects(services.decide(context),{code:'MODEL_RESPONSE_INVALID',provider:'local'});await services.close();await local.close();services=createServices(config);await assert.rejects(services.decide(context),{code:'MODEL_NETWORK_ERROR',provider:'local'});assert.equal(cloudCalls,0);}finally{await services.close();await cloud.close();}
});
