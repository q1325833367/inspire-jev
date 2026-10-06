import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,access} from 'node:fs/promises';
import {chromium} from 'playwright';
import {runCommand} from '../src/platform.mjs';

export async function linuxSandboxProfile(){
 if(process.platform!=='linux')throw Error('AppArmor 配置只用于 Linux');
 const require=createRequire(import.meta.url),root=dirname(require.resolve('playwright-core/package.json'));
 const dry=runCommand(process.execPath,[join(root,'cli.js'),'install','--dry-run','chromium'],{stdio:'pipe'}).stdout.toString();
 const shellRoot=dry.match(/Chrome Headless Shell[^\r\n]*[\r\n]+\s+Install location:\s+([^\r\n]+)/)?.[1]?.trim();
 if(!shellRoot)throw Error('未找到已安装的 Chromium Headless Shell');
 let shell;for(const entry of await readdir(shellRoot,{withFileTypes:true})){if(entry.isDirectory()){const candidate=join(shellRoot,entry.name,'chrome-headless-shell');try{await access(candidate);shell=candidate;break;}catch{}}}
 const paths=[chromium.executablePath(),shell];
 if(paths.some(path=>!path||/[\n\r*?{}\[\]]/.test(path)))throw Error('浏览器路径不能安全写入 AppArmor 配置');
 return 'abi <abi/4.0>,\ninclude <tunables/global>\n\n'+paths.map((path,index)=>`profile inspire-jev-browser-${index} "${path.replaceAll('\\','\\\\').replaceAll('"','\\"')}" flags=(unconfined) {\n  userns,\n}\n`).join('\n');
}
if(fileURLToPath(import.meta.url)===resolve(process.argv[1]||''))process.stdout.write(await linuxSandboxProfile());
