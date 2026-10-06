import {chromium} from 'playwright';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,chmod,readFile,readdir,stat} from 'node:fs/promises';
import {acquire} from './locks.mjs';
import {safeId,atomicJSON} from './storage.mjs';
import {browserAdapter} from './browser-adapter.mjs';

export class Sessions {
  constructor(config,store){this.config=config;this.store=store;this.opened=new Map();}
  async defaultProfile(){
    try{
      const value=JSON.parse(await readFile(join(this.store.root,'browser-profile.json'),'utf8'));
      const id=safeId(value.profileId);
      if(!(await stat(join(this.store.root,'profiles',id))).isDirectory())throw Error('所选档案不存在');
      return id;
    }catch(e){if(e.code==='ENOENT'&&e.path===join(this.store.root,'browser-profile.json'))return 'default';throw Object.assign(Error('默认浏览器档案不可用；先列出并选择已有档案'),{code:'PROFILE_NOT_FOUND'});}
  }
  async useProfile(profileId){
    const id=safeId(profileId);
    try{if(!(await stat(join(this.store.root,'profiles',id))).isDirectory())throw Error('不是档案目录');}
    catch{throw Object.assign(Error('浏览器档案不存在；不会创建空档案替代'),{code:'PROFILE_NOT_FOUND'});}
    await atomicJSON(join(this.store.root,'browser-profile.json'),{profileId:id});
    return{host:this.config.host,defaultProfileId:id,profileRetained:true};
  }
  async profiles(){
    let selected,defaultError;try{selected=await this.defaultProfile();}catch(e){defaultError=e.code;}
    const sessions=await this.store.list('sessions');
    const directories=await readdir(join(this.store.root,'profiles'),{withFileTypes:true});
    return{host:this.config.host,defaultProfileId:selected,defaultError,profiles:directories.filter(d=>d.isDirectory()).map(d=>{
      const records=sessions.filter(s=>s.profileId===d.name).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)),last=records[0];
      return{profileId:d.name,isDefault:d.name===selected,openSessionIds:[...this.opened.values()].filter(s=>s.record.profileId===d.name).map(s=>s.record.id),label:last?.label,lastUrl:last?.lastUrl,updatedAt:last?.updatedAt};
    })};
  }
  async open({sessionId,profileId,url,allowedOrigins=[],headless=false,label='浏览器会话'}={}){
    const id=sessionId?safeId(sessionId):randomUUID();
    if(this.opened.has(id)){if(url)throw Error('会话已打开；导航须使用原现场动作或新建会话');return this.info(id);}
    let previous;try{previous=await this.store.read('sessions',id);}catch(e){if(e.code!=='ENOENT')throw e;}
    const profile=safeId(profileId||previous?.profileId||await this.defaultProfile());
    const origins=allowedOrigins.length?allowedOrigins:previous?.allowedOrigins||[];
    if(!origins.length)throw Error('会话需要允许来源');
    for(const origin of origins)if(new URL(origin).origin!==origin||!['http:','https:'].includes(new URL(origin).protocol))throw Error('来源必须是 HTTP(S) origin');
    if(url&&!origins.includes(new URL(url).origin))throw Error('初始地址不在允许来源中');
    const profilePath=join(this.store.root,'profiles',profile),release=await acquire(`profile:${profilePath}`,id);
    let context;
    try{
      await mkdir(profilePath,{recursive:true,mode:0o700});await chmod(profilePath,0o700);
      context=await chromium.launchPersistentContext(profilePath,{headless,chromiumSandbox:true,proxy:this.config.browserProxy?{server:this.config.browserProxy,bypass:'localhost,127.0.0.1,[::1]'}:undefined,viewport:{width:1280,height:900}});
      const page=context.pages()[0]||await context.newPage();
      const navigationState=profile===previous?.profileId&&url===previous?.lastUrl?previous?.navigation:undefined;
      const cdp=await context.newCDPSession(page);
      const instanceId=randomUUID(),tab={id:randomUUID(),playwright:page,url:async()=>page.url(),back:async destination=>{
        const native=await cdp.send('Page.getNavigationHistory');
        if(native.entries[native.currentIndex-1]?.url===destination)return page.goBack({waitUntil:'domcontentloaded',timeout:10000});
        return page.goto(destination,{waitUntil:'domcontentloaded',timeout:10000});
      }};
      const adapter=browserAdapter(tab,{driver:'playwright',browserId:`jev-${this.config.host}`,instanceId,sessionId:id,allowedOrigins:origins,navigationState});
      const record={id,profileId:profile,label,host:this.config.host,allowedOrigins:origins,status:'open',physicalIdentity:adapter.identity,lastUrl:page.url(),createdAt:previous?.createdAt||Date.now()};
      const session={context,page,adapter,record,release};this.opened.set(id,session);
      context.on('close',()=>this.finishClosed(id,session).catch(()=>{}));
      await this.store.write('sessions',id,record);
      if(url)await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
      record.lastUrl=page.url();await this.store.write('sessions',id,record);
      return this.info(id);
    }catch(e){await context?.close().catch(()=>{});this.opened.delete(id);await release();
      if(process.platform==='linux'&&/No usable sandbox|Chromium sandboxing failed/i.test(e.message))throw Object.assign(Error('Linux 沙箱不可用；请按安装文档配置指定 Chromium 的 AppArmor 规则'),{code:'BROWSER_SANDBOX_UNAVAILABLE'});
      throw e;}
  }
  bindDesktop(tab,options={}){
    const id=options.sessionId||randomUUID();const adapter=browserAdapter(tab,{...options,driver:'desktop',sessionId:id});
    this.opened.set(id,{adapter,record:{id,profileId:null,label:'GPT 侧栏',host:this.config.host,status:'open',allowedOrigins:options.allowedOrigins||[],physicalIdentity:adapter.identity},release:async()=>{}});return id;
  }
  get(id){const session=this.opened.get(safeId(id));if(!session)throw Object.assign(Error('会话不在当前进程；请重新打开原登录档案并核对现场'),{code:'SESSION_NOT_OPEN'});return session;}
  info(id){const {record}=this.get(id);return{...record,mode:record.profileId?'独立受控浏览器':'GPT 侧栏',version:this.config.version};}
  async inspect(id,options={}){
    const s=this.get(id),url=s.page?s.page.url():await s.adapter.observe().then(p=>p.url);
    if(s.record.allowedOrigins.length&&!s.record.allowedOrigins.includes(new URL(url).origin))return{status:'handoff',reason:'needs_origin',url};
    const page=await s.adapter.observe(options);s.record.lastUrl=page.url;s.record.navigation=s.adapter.navigationState();await this.store.write('sessions',id,s.record);return{session:this.info(id),page:s.adapter.publicView(page)};
  }
  async list(){const rows=await this.store.list('sessions');return rows.map(r=>({...r,status:this.opened.has(r.id)?'open':'closed'}));}
  finishClosed(id,s){return s.closedPromise??=(async()=>{if(this.opened.get(id)===s)this.opened.delete(id);s.record.navigation=s.adapter.navigationState();s.record.status='closed';s.record.closedAt=Date.now();await s.release();await this.store.write('sessions',id,s.record);})();}
  async close(id){const s=this.get(id);await s.context?.close();await this.finishClosed(id,s);return{closed:true,profileRetained:true};}
  async closeAll(){for(const id of [...this.opened.keys()])await this.close(id);}
}
