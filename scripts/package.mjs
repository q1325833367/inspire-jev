import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {runCommand} from '../src/platform.mjs';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const locked=JSON.parse(await readFile('npm-shrinkwrap.json','utf8'));if(locked.version!==pkg.version||locked.packages[''].version!==pkg.version||Object.entries(pkg.dependencies).some(([name,version])=>locked.packages[''].dependencies[name]!==version||locked.packages['node_modules/'+name]?.version!==version))throw Error('包版本或依赖与发布锁文件不一致');
const roundIndex=process.argv.indexOf('--round'),round=roundIndex<0?undefined:process.argv[roundIndex+1];if(round&&!/^1\.0-[A-Za-z0-9_-]+$/.test(round))throw Error('候选轮次无效');const destination=round?join('dist','candidates',round):'dist';
runCommand(process.execPath,['scripts/scan-secrets.mjs','--history']);
await mkdir(destination,{recursive:true});
try{await stat(join(destination,`${pkg.name}-${pkg.version}.tgz`));throw Error('同版候选包已存在；禁止重新打包覆盖，请建立新候选目录');}catch(error){if(error.code!=='ENOENT')throw error;}
const packed=JSON.parse(runCommand('npm',['pack','--json','--ignore-scripts','--pack-destination',destination],{stdio:'pipe'}).stdout.toString())[0];
const names=packed.files.map(f=>f.path);
for(const required of ['src/cli.mjs','scripts/linux-sandbox.mjs','integrations/pi/index.ts','skills/jev-browser/SKILL.md','plugin.json','mcp.json','README.md','README.en.md','LICENSE','NOTICE','npm-shrinkwrap.json'])if(!names.includes(required))throw Error(`安装包缺少 ${required}`);
const forbidden=names.filter(name=>/(?:^|\/)(?:node_modules|artifacts|\.git|\.env(?:\..*)?|config\.json|credentials\.env|profiles|private-backups)(?:\/|$)/.test(name));
if(forbidden.length)throw Error('安装包包含私密或运行时目录');
const archive=join(destination,packed.filename);
runCommand(process.execPath,['scripts/scan-secrets.mjs','--archive',archive]);
const hash=createHash('sha256').update(await readFile(archive)).digest('hex');
const manifest={name:pkg.name,version:pkg.version,status:pkg.version.includes('-')?'RC':'candidate',protocol:2,entries:['gpt','pi','mcp'],node:pkg.engines.node,archive:packed.filename,sha256:hash,files:names};
await writeFile(join(destination,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(join(destination,'SHA256SUMS'),`${hash}  ${packed.filename}\n`,{flag:'wx'});
console.log(JSON.stringify({version:pkg.version,archive:packed.filename,files:names.length,bytes:packed.size,sha256:hash}));
