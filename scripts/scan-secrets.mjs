import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {homedir} from 'node:os';

const argv=process.argv.slice(2),findings=[],checked=new Set(),known=[];
const patterns=[['API key',/\b(?:sk-[A-Za-z0-9]{20,}|apikey_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{35})\b/],['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],['browser connection token',/PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*["']?[A-Za-z0-9_-]{30,}/],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]];
for(const [key,value]of Object.entries(process.env))if(/(?:API_KEY|TOKEN)$/.test(key)&&value.length>15)known.push(value);
for(const dir of [process.env.INSPIRE_JEV_HOME,process.env.JEV_AGENT_HOME,join(homedir(),'Library','Application Support','Jev Agent')].filter(Boolean)){
  try{const c=JSON.parse(readFileSync(join(dir,'config.json'),'utf8'));if(c.envFile)for(const [key,value]of Object.entries(parseEnv(readFileSync(c.envFile,'utf8'))))if(/_API_KEY$|_TOKEN$/.test(key)&&value.length>15)known.push(value);}catch{}
}
function inspect(name,data){
  if(checked.has(name))return;checked.add(name);const text=data.toString('utf8');
  if(known.some(value=>text.includes(value)))findings.push({file:name,kind:'active credential'});
  for(const [kind,re]of patterns)if(re.test(text))findings.push({file:name,kind});
}
const git=args=>execFileSync('git',args,{maxBuffer:30*1024*1024});
const archives=argv.flatMap((v,i)=>v==='--archive'?[argv[i+1]]:[]);
if(archives.length){for(const path of archives)inspect(path,gunzipSync(readFileSync(path)));}
else if(argv.includes('--staged')){
  const names=git(['diff','--cached','--name-only','--diff-filter=ACMR','-z']).toString().split('\0').filter(Boolean);
  for(const name of names)inspect(name,git(['show',`:${name}`]));
}else{
  const names=git(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean);
  for(const name of names)if(existsSync(name)&&statSync(name).isFile())inspect(name,readFileSync(name));
}
if(argv.includes('--history')){
  for(const line of git(['rev-list','--objects','--all']).toString().split('\n').filter(Boolean)){
    const oid=line.split(' ')[0];if(git(['cat-file','-t',oid]).toString().trim()==='blob')inspect(`history:${oid}`,git(['cat-file','blob',oid]));
  }
}
console.log(JSON.stringify({checked:checked.size,findings}));if(findings.length)process.exitCode=1;
