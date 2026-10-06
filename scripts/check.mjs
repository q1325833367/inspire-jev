import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
for(const name of await readdir('src'))if(name.endsWith('.mjs'))execFileSync(process.execPath,['--check',join('src',name)],{stdio:'inherit'});
for(const name of ['package.json','package-lock.json','plugin.json','mcp.json','.mcp.json'])JSON.parse(await readFile(name,'utf8'));
console.log('源码语法与清单 JSON 已通过');
