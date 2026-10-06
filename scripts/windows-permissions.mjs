import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {secureDirectory,secureFile} from '../src/platform.mjs';
if(process.platform!=='win32')throw Error('此探针只用于 Windows');
const directory=await mkdtemp(join(tmpdir(),'inspire-acl-probe-'));
try{
 console.log(JSON.stringify({powershell:execFileSync('powershell.exe',['-NoLogo','-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8'}).trim(),architecture:process.arch}));
 await secureDirectory(directory);await writeFile(join(directory,'fixture.txt'),'public test fixture');await secureFile(join(directory,'fixture.txt'));console.log(JSON.stringify({privatePermissions:true}));
}catch(e){console.log(JSON.stringify({code:e.code,message:e.message,stderr:e.cause?.stderr,exitCode:e.cause?.code}));process.exitCode=1;}
finally{await rm(directory,{recursive:true,force:true});}
