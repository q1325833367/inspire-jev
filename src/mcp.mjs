import {McpServer} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {Agent} from './agent.mjs';
import {VERSION} from './config.mjs';
import {instructions,toolDefinitions} from './tools.mjs';

export async function startMCP(options={}){
  const agent=await Agent.create(options);
  const server=new McpServer({name:'inspire-jev',version:VERSION},{instructions:instructions+' 会话属于本服务的 '+agent.config.host+' 命名空间；打开、执行、接管和恢复必须使用同一服务。'});
  server.registerResource('jev-version','jev://version',{mimeType:'application/json'},async()=>({contents:[{uri:'jev://version',mimeType:'application/json',text:JSON.stringify({version:VERSION,host:agent.config.host,buildFingerprint:agent.config.buildFingerprint})}]}));
  for(const d of toolDefinitions)server.registerTool(d.name,{title:d.title,description:d.description,inputSchema:d.schema,annotations:{readOnlyHint:!!d.readOnly,destructiveHint:!d.readOnly,openWorldHint:true}},async(args,ctx)=>{
    try{
      const token=ctx.mcpReq?._meta?.progressToken;
      let progress=0;
      const value=await agent.call(d.name,args,{signal:ctx.mcpReq?.signal,onProgress:token===undefined?undefined:async p=>ctx.mcpReq.notify({method:'notifications/progress',params:{progressToken:token,progress:++progress,message:JSON.stringify(p)}})});
      const result=Array.isArray(value)?{sessions:value}:value;
      return{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
    }catch(e){return{isError:true,content:[{type:'text',text:JSON.stringify({status:'error',code:e.code||'TOOL_ERROR',message:e.message})}]};}
  });
  await server.connect(new StdioServerTransport());
  const shutdown=async()=>{await agent.shutdown();await server.close();};
  return{server,agent,shutdown};
}
