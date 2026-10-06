import {Type} from 'typebox';
import {Agent} from '../../src/agent.mjs';
import {instructions,toolDefinitions,toolJSONSchema} from '../../src/tools.mjs';

export default function(pi:any){
  let runtime:Promise<Agent>|undefined;
  const get=()=>runtime??=Agent.create({host:'pi'});
  for(const d of toolDefinitions)pi.registerTool({
    name:d.name,label:d.title,description:d.description,
    promptSnippet:d.description,
    promptGuidelines:d.name==='jev_run'?[instructions]:[],
    parameters:Type.Unsafe(toolJSONSchema(d)),
    async execute(toolCallId:string,params:any,signal:AbortSignal,onUpdate:any,ctx:any){
      const args=d.schema.parse(params);
      const agent:any=await get();await agent.observer?.nativeTools(pi.getActiveTools());
      const result=await agent.call(d.name,args,{signal,onProgress:async(progress:any)=>onUpdate?.({content:[{type:'text',text:JSON.stringify(progress)}],details:{progress}})});
      if(result?.runId)pi.appendEntry('jev-run',{runId:result.runId,sessionId:result.sessionId,status:result.status});
      return{content:[{type:'text',text:JSON.stringify(result)}],details:{result}};
    }
  });
  pi.on('session_shutdown',async()=>{if(runtime)await(await runtime).shutdown();});
}
