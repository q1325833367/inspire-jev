import {spawn} from 'node:child_process';
export async function codexRPC(){
 const proc=spawn('codex',['app-server','--stdio'],{stdio:['pipe','pipe','pipe']}),pending=new Map(),diagnostics=[];let seq=0,buffer='';
 proc.stderr.on('data',chunk=>{for(const line of String(chunk).split('\n'))if(line.includes('jev-agent')&&/failed|error/i.test(line))diagnostics.push(line.slice(0,600));});
 proc.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){let response;try{response=JSON.parse(line);}catch{continue;}const request=pending.get(response.id);if(!request)continue;pending.delete(response.id);clearTimeout(request.timer);response.error?request.reject(Error(JSON.stringify(response.error))):request.resolve(response.result);}});
 proc.on('exit',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Codex app-server 已退出'));}pending.clear();});
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' 超时'));},45000);pending.set(id,{resolve,reject,timer});proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const close=()=>{proc.stdin.end();setTimeout(()=>proc.kill('SIGTERM'),2000).unref();};
 try{await call('initialize',{clientInfo:{name:'jev-local-integration',title:'Jev 本机集成验证',version:'1'},capabilities:{experimentalApi:true,requestAttestation:false}});proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'initialized'})+'\n');return{call,close,diagnostics};}catch(error){close();throw error;}
}
