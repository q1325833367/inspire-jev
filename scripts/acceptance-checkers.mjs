import {hash} from './acceptance-evidence.mjs';
const gt='https://www.gutenberg.org',wiki='https://en.wikipedia.org',gh='https://github.com';
const absolute=(href,url)=>{try{return new URL(href,url).href;}catch{return null;}};
export function checkBusiness(caseId,events,{long=false,finalOutput,requirements={}}={}){
 const snapshots=events.filter(e=>e.type==='snapshot').map(e=>e.snapshot),actions=events.filter(e=>e.type==='action'&&e.phase==='acknowledged'),last=snapshots.at(-1),reasons=[];
 const require=(condition,reason)=>{if(!condition)reasons.push(reason);};
 const material=[...events.filter(e=>e.type==='tool_end'&&e.collection).map(e=>e.collection),finalOutput?.results],strings=[];
 const flatten=v=>{if(typeof v==='string')strings.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(flatten);};flatten(material);
 const compact=s=>String(s||'').replace(/\s+/g,'').replace(/\(\d{4}-\d{2}-\d{2}\)/g,''),received=text=>!!text&&strings.some(s=>compact(s).includes(compact(text)));
 if(caseId==='wiki-fields'){
  const topic=requirements.topic||'Alan Turing',fields=requirements.fields||['Born','Education','Known for'];const page=snapshots.findLast(s=>s.url===wiki+'/wiki/'+topic.replace(/ /g,'_')&&s.heading===topic);require(page&&received(topic)&&received(page.url),'条目身份与采集来源');for(const field of fields){const labels=field==='Education'?['Education','Alma mater']:[field],value=page?.fields.find(x=>labels.some(label=>x.startsWith(label)&&x.slice(label.length).trim()));require(value&&(received(value)||labels.some(label=>value.startsWith(label)&&received(value.slice(label.length).trim()))),field);}require(events.some(a=>a.type==='action'&&a.phase==='issued'&&a.kind==='fill'&&a.valueHash===hash(topic)),'实际搜索填写');
 }else if(caseId==='wiki-section'){
  const page=snapshots.find(s=>s.url===wiki+'/wiki/Alan_Turing#Death');require(page?.section==='Death'&&page.paragraph?.trim()&&received(page.paragraph)&&received(page.url),'章节首段与采集来源');require(events.some(a=>a.type==='action'&&a.phase==='issued'&&a.directoryLink===true&&a.kind==='click'&&absolute(a.href,a.documentUrl)===wiki+'/wiki/Alan_Turing#Death'),'实际目录定位');
 }else if(caseId==='gutenberg-author'||long){
  const count=long?27:requirements.count||3,author=requirements.author||'Charles Dickens',discover=snapshots.find(s=>long?s.ranking?.length===27:s.books?.length>=count&&new URL(s.url).searchParams.get('query')===author);const books=long?discover?.ranking:discover?.books?.slice(0,count),links=books?.map(b=>absolute(b.href,discover.url))||[];require(links.length===count&&new Set(links).size===count,'现场发现书目');
  const detailVisits=actions.filter(a=>a.kind==='click'&&links.includes(absolute(a.href,a.documentUrl))).map(a=>absolute(a.href,a.documentUrl));require(JSON.stringify(detailVisits)===JSON.stringify(links),'逐本现场顺序');
  for(const [i,url] of links.entries()){const page=snapshots.find(s=>s.url===url&&s.metadata?.length);const id=url.match(/\/ebooks\/(\d+)$/)?.[1];require(id&&page?.heading&&page.metadata.some(x=>x===`eBook-No. ${id}`)&&page.metadata.some(x=>/^Title\s+\S/.test(x))&&received(url)&&received(page.heading)&&page.metadata.every(received),`详情身份与元数据:${i+1}`);require(page?.formats?.length===page?.formatCount&&page.formats.every(f=>!!f.text&&absolute(f.href,url)?.startsWith(gt)&&received(f.text)&&(received(f.href)||received(absolute(f.href,url)))),`完整采集格式:${i+1}`);}
  if(requirements.returnToList!==false)require(last?.url===discover?.url,'最终返回原列表');require(actions.filter(a=>a.kind==='back'&&a.href===discover?.url).length>=count,'逐本返回');if(long)require(actions.length>=55,'至少55次实际操作');
 }else if(caseId==='gutenberg-ranking'){
  const count=requirements.count||10,page=snapshots.find(s=>s.ranking?.length>=count),rows=page?.ranking.slice(0,count)||[];const parsed=rows.map(x=>({url:absolute(x.href,page.url),downloads:Number(x.text.match(/\((\d+)\)\s*$/)?.[1])}));require(rows.length===count&&new Set(parsed.map(x=>x.url)).size===count&&parsed.every(x=>Number.isFinite(x.downloads)),'现场条目与有效数量');
  const sorted=requirements.sorted===false?parsed:[...parsed].sort((a,b)=>b.downloads-a.downloads);require(Array.isArray(finalOutput?.ranking)&&JSON.stringify(finalOutput.ranking.map(x=>({url:x.url,downloads:x.downloads})))===JSON.stringify(sorted),'数量排序及输出');
 }else if(caseId==='github-public'){
  const repo=requirements.repo||'browser-use/jev-ultrafast';require(snapshots.some(s=>s.url===gh+'/'+repo&&s.readme?.length===1500&&received(s.url)&&strings.some(t=>t.length>=1400&&t.length<=1500&&compact(t).startsWith(compact(s.readme).slice(0,1000)))),'README前1500字与采集来源');require(snapshots.some(s=>s.url.startsWith(gh+'/'+repo+'/blob/')&&s.url.endsWith('/LICENSE')&&s.license?.includes('MIT License')&&s.license.includes('OTHER DEALINGS IN THE SOFTWARE.')&&!s.licenseTruncated&&received(s.url)&&received(s.license)),'完整许可证与采集来源');
 }else if(caseId==='github-private-draft'){
  const f=last?.privateForm;require(last?.url.startsWith(gh+'/new')&&last.authenticated,'已登录新建表单现场');require(f?.nameMatches,'名称实值');require(requirements.descriptionHash?f?.descriptionHash===requirements.descriptionHash:f?.descriptionLength>=(requirements.descriptionMin||20)&&f.descriptionLength<=60&&f.descriptionChinese&&f.descriptionUse,'中文描述');require(f?.privateChecked,'Private实际选中');require(!events.some(e=>e.type==='request'&&e.repositoryCreation)&&!actions.some(a=>a.isSubmit),'未提交');
 }else require(false,'未知业务用例');
 if(caseId!=='github-private-draft'&&caseId!=='gutenberg-ranking')require(strings.length>0,'主模型已收到采集结果');
 return{passed:reasons.length===0,reasons,actions:actions.length,bookCount:long?27:undefined,sourceURLs:[...new Set(snapshots.map(s=>s.url))]};
}
