import {createInterface,emitKeypressEvents} from 'node:readline';

export async function prompt(label,{secret=false,defaultValue='',input=process.stdin,output=process.stderr}={}){
  if(!input.isTTY)throw Object.assign(Error('配置向导需要交互终端；自动化请使用环境变量或 --env-file'),{code:'INTERACTIVE_INPUT_REQUIRED'});
  if(!secret){const rl=createInterface({input,output});try{return await new Promise(resolve=>rl.question(`${label}${defaultValue?` [${defaultValue}]`:''}：`,v=>resolve(v.trim()||defaultValue)));}finally{rl.close();}}
  output.write(`${label}${defaultValue?'（回车保留）':''}：`);
  const wasRaw=input.isRaw;emitKeypressEvents(input);input.setRawMode(true);input.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const done=(error)=>{input.off('keypress',onKey);input.setRawMode(!!wasRaw);input.pause();output.write('\n');error?reject(error):resolve(value.trim()||defaultValue);};
    const onKey=(str,key={})=>{if(key.ctrl&&key.name==='c'){done(Object.assign(Error('配置已取消'),{code:'CONFIG_CANCELLED'}));return;}if(key.name==='return'||key.name==='enter'){done();return;}if(key.name==='backspace'){if(value){value=value.slice(0,-1);output.write('\b \b');}return;}if(str&&!key.ctrl&&!key.meta&&!/[\r\n\x00-\x1f]/.test(str)){value+=str;output.write('*'.repeat([...str].length));}};
    input.on('keypress',onKey);
  });
}
