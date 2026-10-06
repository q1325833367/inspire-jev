import {readFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {userDataHome,secureDirectory} from './platform.mjs';

export const VERSION = '1.0.0-rc.4';
export const defaultHome = () => {
  if(process.env.INSPIRE_JEV_HOME||process.env.JEV_AGENT_HOME)return userDataHome();
  try{const installed=JSON.parse(readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))),'installed-home.json'),'utf8'));if(typeof installed.home==='string')return installed.home;}catch{}
  const legacy=join(homedir(),'Library','Application Support','Jev Agent');
  return existsSync(join(legacy,'config.json'))?legacy:userDataHome();
};
export async function settings(overrides = {}) {
  const home = overrides.home || defaultHome();
  let file = {};
  try {file = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'));}
  catch (e) {if (e.code !== 'ENOENT') throw new Error('本地配置无效');}
  const result = {browserProxy:null, modelProxy:null, trace:false, ...file, ...overrides,home};
  if(!result.envFile&&existsSync(join(home,'credentials.env')))result.envFile=join(home,'credentials.env');
  for (const key of ['browserProxy','modelProxy']) if (result[key]) {
    const u = new URL(result[key]);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('代理应为不含凭据的 HTTP 地址');
  }
  await secureDirectory(home);
  return result;
}
