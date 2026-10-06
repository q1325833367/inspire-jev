import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const packageRoot=dirname(dirname(fileURLToPath(import.meta.url)));
export const publicFiles=['package.json','npm-shrinkwrap.json','package-lock.json','src','integrations','scripts','skills','plugin.json','mcp.json','.mcp.json','README.md','README.en.md','docs','LICENSE','NOTICE','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md'];
export async function sourceDigest(root,{portable=true}={}){
  const hash=createHash('sha256');
  async function add(path){
    let rows;
    try{rows=await readdir(join(root,path),{withFileTypes:true});}
    catch(error){
      if(error.code==='ENOTDIR'){hash.update((portable?path.replaceAll('\\','/'):path)+'\0');hash.update(await readFile(join(root,path)));return;}
      if(error.code==='ENOENT')return;
      throw error;
    }
    for(const row of rows.sort((a,b)=>a.name.localeCompare(b.name)))await add(join(path,row.name));
  }
  for(const name of publicFiles)await add(name);
  return hash.digest('hex');
}
