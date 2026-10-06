import {mkdir,chmod,readFile,access} from 'node:fs/promises';
import {homedir,platform as osPlatform} from 'node:os';
import {join,delimiter,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import spawn from 'cross-spawn';

const exec=promisify(execFile);
export function userDataHome({platform=osPlatform(),env=process.env,home=homedir()}={}){
  if(env.INSPIRE_JEV_HOME||env.JEV_AGENT_HOME)return env.INSPIRE_JEV_HOME||env.JEV_AGENT_HOME;
  if(platform==='win32')return join(env.LOCALAPPDATA||join(home,'AppData','Local'),'InspireJev');
  if(platform==='darwin')return join(home,'Library','Application Support','InspireJev');
  return join(env.XDG_DATA_HOME||join(home,'.local','share'),'inspire-jev');
}
export async function secureDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  if(process.platform!=='win32'){await chmod(path,0o700);return;}
  try{await setPrivateACL(path,true);}
  catch{throw Object.assign(Error('无法设置私密目录的 Windows ACL'),{code:'PRIVATE_PERMISSIONS_ERROR'});}
}
let sidPromise;
async function windowsUserSID(){
  return sidPromise??=(async()=>{
    const {stdout}=await exec('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true});
    const sid=stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if(!sid)throw Object.assign(Error('无法读取当前 Windows 用户身份'),{code:'PRIVATE_PERMISSIONS_ERROR'});
    return sid;
  })();
}
export async function secureFile(path){
  if(process.platform!=='win32'){await chmod(path,0o600);return;}
  try{await setPrivateACL(path,false);}
  catch{throw Object.assign(Error('无法设置凭据文件的 Windows ACL'),{code:'PRIVATE_PERMISSIONS_ERROR'});}
}
async function setPrivateACL(path,directory){
  const sid=await windowsUserSID(),literal=String(path).replaceAll("'","''");
  const inheritance=directory?'([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit)':'[System.Security.AccessControl.InheritanceFlags]::None';
  const command=`$ErrorActionPreference='Stop'; $path='${literal}'; $sid=[System.Security.Principal.SecurityIdentifier]::new('${sid}'); $acl=[System.Security.AccessControl.${directory?'Directory':'File'}Security]::new(); $acl.SetAccessRuleProtection($true,$false); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,${inheritance},[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $path -AclObject $acl; $actual=Get-Acl -LiteralPath $path; if (-not $actual.AreAccessRulesProtected) { throw 'DACL is not protected' }; foreach ($r in $actual.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -ne $sid.Value) { throw 'Unexpected access rule' } }`;
  await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true});
}
export async function processIdentity(pid){
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('无效进程编号');
  if(process.platform==='linux'){
    try{
      const [stat,boot]=await Promise.all([readFile(`/proc/${pid}/stat`,'utf8'),readFile('/proc/sys/kernel/random/boot_id','utf8')]);
      const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
      if(!fields[19])throw Error('进程身份格式无效');
      return `linux:${boot.trim()}:${fields[19]}`;
    }catch(e){if(e.code==='ENOENT')return null;throw Object.assign(Error('无法核对进程身份'),{code:'PROCESS_IDENTITY_UNAVAILABLE'});}
  }
  if(process.platform==='win32'){
    const command=`try { $p=Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks } catch { if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId*') { exit 3 }; exit 4 }`;
    try{const {stdout}=await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true});const value=stdout.trim();if(!/^\d+$/.test(value))throw Error('进程身份格式无效');return `windows:${value}`;}
    catch(e){if(e.code===3)return null;throw Object.assign(Error('无法核对 Windows 进程身份'),{code:'PROCESS_IDENTITY_UNAVAILABLE'});}
  }
  try{const {stdout}=await exec('ps',['-p',String(pid),'-o','lstart=']);return stdout.trim()||null;}
  catch(e){if(e.code===1)return null;throw Object.assign(Error('无法核对进程身份'),{code:'PROCESS_IDENTITY_UNAVAILABLE'});}
}
export function runCommand(command,args,options={}){
  const result=spawn.sync(command,args,{stdio:'inherit',windowsHide:true,...options});
  if(result.error)throw Object.assign(Error(`无法启动 ${command}；请检查安装与 PATH`),{code:'COMMAND_UNAVAILABLE'});
  if(result.status!==0)throw Object.assign(Error(`${command} 执行失败，退出码 ${result.status}`),{code:'COMMAND_FAILED'});
  return result;
}
export async function commandAvailable(command){
  const extensions=process.platform==='win32'?(process.env.PATHEXT||'.COM;.EXE;.BAT;.CMD').split(';'):[''];
  for(const dir of (process.env.PATH||'').split(delimiter))for(const extension of extname(command)?['']:extensions){try{await access(join(dir,command+extension));return true;}catch{}}
  return false;
}
