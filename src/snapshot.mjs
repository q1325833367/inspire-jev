// Pure, read-only functions serialized into a page/frame by the adapter.
export function capturePage(options={}) {
  if(!document.body)return null;
  const limits={maxNodes:500,timeMs:50,maxCandidates:120,maxText:5000,...options.limits};
  const documentId=String(performance.timeOrigin),began=performance.now();
  const actions=[],words=[],styleCache=new WeakMap(),rectCache=new WeakMap(),authForms=new WeakMap(),seenAuth=new Set(),scrollCandidates=[];let nodes=0,textSize=0,offscreen=0,hidden=0,sensitive=0;
  const auth=e=>{if(!e.form)return false;if(!authForms.has(e.form))authForms.set(e.form,!!e.form.querySelector('input[type="password"],input[autocomplete="one-time-code"]'));return authForms.get(e.form);};
  const styles=e=>{if(!styleCache.has(e))styleCache.set(e,getComputedStyle(e));return styleCache.get(e);};
  const rects=e=>{if(!rectCache.has(e))rectCache.set(e,e.getBoundingClientRect());return rectCache.get(e);};
  const selector='a[href],button,input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[role="combobox"],[role="textbox"],[role="searchbox"]';
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const formGuard=e=>{if(!e.form)return null;if(e.form.elements.length>50)return 'unsupported_large_form';let hash=2166136261;for(const x of e.form.elements){if(['password','hidden','file'].includes(x.type)||/password|one-time-code|cc-number|cc-csc/.test(x.autocomplete||''))continue;const value=[x.id,x.name,x.type,x.value,x.checked,x.disabled].join('|');for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);}return String(hash>>>0);};
  const name=e=>norm((e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')||e.getAttribute('aria-label')||Array.from(e.labels||[],label=>{const w=document.createTreeWalker(label,NodeFilter.SHOW_TEXT,{acceptNode:t=>t.parentElement?.closest('select,textarea,button')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let text='',node;while((node=w.nextNode())&&text.length<240)text+=node.textContent;return text;}).join(' ')||(['submit','button'].includes(e.type)?e.value:'')||(!['INPUT','SELECT','TEXTAREA'].includes(e.tagName)?e.textContent:'')||e.getAttribute('placeholder')||e.getAttribute('title')||e.getAttribute('name')||'').slice(0,240);
  const path=e=>{const parts=[];for(let p=e;p&&p.nodeType===1;p=p.parentElement){if(p.id){parts.unshift(`[id=${JSON.stringify(p.id)}]`);break;}let index=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)index++;parts.unshift(`${p.tagName.toLowerCase()}:nth-of-type(${index})`);}return parts.join(' > ');};
  const visible=e=>{
    const r=rects(e);if(r.width<=0||r.height<=0||e.closest('[aria-hidden="true"],[inert]'))return false;
    const s=styles(e);if(s.visibility==='hidden'||s.display==='none'||s.opacity==='0')return false;
    return true;
  };
  const push=(a,cap=limits.maxCandidates-10)=>{if(actions.length<Math.max(1,cap))actions.push({...a,id:`e${actions.length+1}`});};
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT,{acceptNode:e=>e.matches('script,style,noscript,template')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  if(options.cursor?.documentId===documentId&&options.cursor?.url===location.href&&options.cursor?.selector){
    const last=document.querySelector(options.cursor.selector);if(last)walker.currentNode=last;
  }
  let e,last,hasMore=false;
  while((e=walker.nextNode())){
    last=e;nodes++;
    if(scrollCandidates.length<7&&['auto','scroll'].includes(styles(e).overflowY)&&e.scrollHeight>e.clientHeight+5&&visible(e))scrollCandidates.push(e);
    if(e.matches(selector)&&!e.matches(':disabled')&&!e.closest('[aria-disabled="true"]')&&e.type!=='hidden'){
      if(!visible(e)){hidden++;}
      else{
        const r=rects(e),inViewport=r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
        if(!inViewport)offscreen++;
        const credential=['INPUT','TEXTAREA','SELECT'].includes(e.tagName)&&/password|api[ _-]?key|access[ _-]?token|authorization/i.test([e.name,e.id,e.getAttribute('aria-label'),name(e)].join(' '));
        const secret=auth(e)||credential||['password','file'].includes(e.type)||/password|one-time-code|cc-number|cc-csc/.test(e.autocomplete||'');if(auth(e))seenAuth.add(e.form);
        if(secret)sensitive++;
        else{
          const role=e.getAttribute('role')||({A:'link',BUTTON:'button',SELECT:'combobox',TEXTAREA:'textbox',SUMMARY:'button'})[e.tagName]||(['checkbox','radio'].includes(e.type)?e.type:['button','submit','reset','image'].includes(e.type)?'button':'textbox');
          const contextNode=e.closest('form,dialog,li,tr,[role="row"]')||e.parentElement;
          const context=norm(Array.from(contextNode?.childNodes||[]).filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ')).slice(0,220);
          const base={selector:path(e),role,label:name(e)||role,inViewport,context,href:e.getAttribute('href'),documentId,documentUrl:location.href,formGuard:formGuard(e),formAction:e.form?new URL(e.getAttribute('formaction')||e.form.action,location.href).href:undefined,formMethod:e.form?(e.getAttribute('formmethod')||e.form.method).toLowerCase():undefined,isSubmit:!!e.form&&e.type==='submit'&&(e.getAttribute('formmethod')||e.form.method).toLowerCase()!=='get'};
          if(e.tagName==='SELECT'){
            for(const o of e.options)if(!o.disabled&&!o.closest('optgroup[disabled]')&&!o.selected)push({...base,kind:'select',label:`${base.label} → ${o.label}`,value:o.value,current_value:Array.from(e.selectedOptions).map(x=>x.label).join(', ')});
          }else if(['checkbox','radio','switch'].includes(role))push({...base,kind:'check',checked:e.checked??e.getAttribute('aria-checked')==='true'});
          else if(!e.readOnly&&(e.isContentEditable||e.tagName==='TEXTAREA'||e.tagName==='INPUT'&&!['button','submit','reset','image','range','color'].includes(e.type)||['textbox','searchbox'].includes(role))){push({...base,kind:'fill',value:'value'in e?String(e.value):e.textContent});push({...base,isSubmit:!!e.form&&e.form.method.toLowerCase()!=='get',kind:'press',label:`${base.label} → Enter`,key:'Enter'});}
          else push({...base,kind:'click'});
        }
      }
    }
    if(textSize<limits.maxText&&!e.closest('input,textarea,select,[contenteditable="true"]')){const r=rects(e);if(r.bottom>0&&r.top<innerHeight)for(const t of e.childNodes)if(t.nodeType===3){const text=norm(t.textContent);if(text){words.push(text.slice(0,limits.maxText-textSize));textSize+=text.length;}}}
    if(nodes>=limits.maxNodes||actions.length>=Math.max(1,limits.maxCandidates-10)||performance.now()-began>=limits.timeMs){hasMore=!!walker.nextNode();break;}
  }
  const regions=[];
  // Only the scanned subtree and ancestors are examined, never all body nodes.
  const scrolling=document.scrollingElement;
  const scrollPush=a=>push(a,limits.maxCandidates-3);
  if(scrolling){const region={selector:null,label:'页面',y:scrollY,height:scrolling.scrollHeight,viewport:innerHeight,x:Math.floor(innerWidth/2),cy:Math.floor(innerHeight/2)};regions.push(region);if(region.y+region.viewport<region.height-3)scrollPush({kind:'scroll',label:'向下滚动页面',direction:'down',x:region.x,y:region.cy,region:null,documentId,documentUrl:location.href});if(region.y>0)scrollPush({kind:'scroll',label:'向上滚动页面',direction:'up',x:region.x,y:region.cy,region:null,documentId,documentUrl:location.href});}
  for(const p of scrollCandidates){if(p===scrolling)continue;const r=rects(p);const region={selector:path(p),label:name(p)||'滚动区域',y:p.scrollTop,height:p.scrollHeight,viewport:p.clientHeight,x:r.x+r.width/2,cy:r.y+r.height/2};regions.push(region);if(region.y+region.viewport<region.height-3)scrollPush({kind:'scroll',label:`向下滚动 ${region.label}`,direction:'down',x:region.x,y:region.cy,region:region.selector,documentId,documentUrl:location.href});if(region.y>0)scrollPush({kind:'scroll',label:`向上滚动 ${region.label}`,direction:'up',x:region.x,y:region.cy,region:region.selector,documentId,documentUrl:location.href});}
  // Discovery/wait are always available, independently of the candidate cap.
  if(hasMore)actions.push({id:'observe_more',kind:'observe',label:'继续发现下一批候选',documentId,documentUrl:location.href});
  actions.push({id:'wait',kind:'wait',label:'等待页面更新',documentId,documentUrl:location.href});
  return{url:location.href,title:document.title,documentId,text:words.join('\n').slice(0,limits.maxText),actions,cursor:hasMore&&last?{documentId,url:location.href,selector:path(last)}:null,
    coverage:{candidateScope:'batch',scannedNodes:nodes,truncated:hasMore,offscreen,hidden,sensitive,loginForms:seenAuth.size,totalCandidates:actions.length,visibleCandidates:actions.filter(a=>a.inViewport).length,scrollRegions:regions,elapsed_ms:performance.now()-began,unsupported:{canvas:document.getElementsByTagName('canvas').length,frames:document.getElementsByTagName('iframe').length}}};
}

export function probeTarget(action,targetElement) {
  if(action?.nodeType===1){const element=action;action=targetElement;targetElement=element;}
  if(action.documentId&&String(performance.timeOrigin)!==action.documentId)return{ok:false,reason:'document_changed'};
  if(action.documentUrl&&location.href!==action.documentUrl)return{ok:false,reason:'url_changed'};
  if(!action.selector)return{ok:true,url:location.href,documentId:String(performance.timeOrigin)};
  const all=document.querySelectorAll(action.selector);if(all.length!==1)return{ok:false,reason:'target_count',count:all.length};
  if(targetElement&&all[0]!==targetElement)return{ok:false,reason:'target_replaced'};
  const e=all[0],norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  if(action.formAction&&(!e.form||new URL(e.getAttribute('formaction')||e.form.action,location.href).href!==action.formAction||(e.getAttribute('formmethod')||e.form.method).toLowerCase()!==action.formMethod))return{ok:false,reason:'form_destination_changed'};
  if(action.formGuard){if(action.formGuard==='unsupported_large_form'||!e.form||e.form.elements.length>50)return{ok:false,reason:'form_scope_unsupported'};let hash=2166136261;for(const x of e.form.elements){if(['password','hidden','file'].includes(x.type)||/password|one-time-code|cc-number|cc-csc/.test(x.autocomplete||''))continue;const value=[x.id,x.name,x.type,x.value,x.checked,x.disabled].join('|');for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);}if(String(hash>>>0)!==action.formGuard)return{ok:false,reason:'form_changed'};}
  const label=norm((e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')||e.getAttribute('aria-label')||Array.from(e.labels||[],label=>{const w=document.createTreeWalker(label,NodeFilter.SHOW_TEXT,{acceptNode:t=>t.parentElement?.closest('select,textarea,button')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let text='',node;while((node=w.nextNode())&&text.length<240)text+=node.textContent;return text;}).join(' ')||(['button','submit'].includes(e.type)?e.value:'')||(!['INPUT','SELECT','TEXTAREA'].includes(e.tagName)?e.textContent:'')||e.getAttribute('placeholder')||e.getAttribute('title')||e.getAttribute('name')||'').slice(0,240);
  const expected=action.kind==='select'?action.label.split(' → ')[0]:action.kind==='press'?action.label.replace(/ → Enter$/,''):action.label;
  if(label&&label!==expected)return{ok:false,reason:'label_changed'};
  if(e.matches(':disabled')||e.closest('[aria-disabled="true"],[inert]'))return{ok:false,reason:'disabled'};
  if(action.href!==undefined&&e.getAttribute('href')!==action.href)return{ok:false,reason:'href_changed'};
  if(action.kind==='fill'&&String('value'in e?e.value:e.textContent)!==String(action.value))return{ok:false,reason:'input_changed'};
  if(action.kind==='check'&&(e.checked??e.getAttribute('aria-checked')==='true')!==action.checked)return{ok:false,reason:'checked_changed'};
  if(action.kind==='select'&&Array.from(e.selectedOptions||[]).map(o=>o.label).join(', ')!==action.current_value)return{ok:false,reason:'selection_changed'};
  return{ok:true,url:location.href,documentId:String(performance.timeOrigin)};
}

export function checkPage(checks) {
  const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
  const name=e=>norm(e.getAttribute('aria-label')||Array.from(e.labels||[],label=>{const w=document.createTreeWalker(label,NodeFilter.SHOW_TEXT,{acceptNode:t=>t.parentElement?.closest('select,textarea,button')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let text='',node;while((node=w.nextNode())&&text.length<240)text+=node.textContent;return text;}).join(' ')||(!['INPUT','SELECT','TEXTAREA'].includes(e.tagName)?e.textContent:'')||e.getAttribute('placeholder')||e.getAttribute('name'));
  const details=checks.map(c=>{
    if(c.kind==='url')return{kind:c.kind,ok:c.equals?location.href===c.equals:c.excludes?!location.href.includes(c.excludes):location.href.includes(c.includes),actual:location.href,expected:c.equals??c.includes??c.excludes};
    if(c.kind==='title')return{kind:c.kind,ok:c.equals?norm(document.title)===norm(c.equals):norm(document.title).includes(norm(c.includes)),actual:document.title,expected:c.equals??c.includes};
    if(c.kind==='text'){
      const root=c.selector?document.querySelector(c.selector):document.body;if(!root)return{kind:c.kind,ok:false,reason:'missing_scope'};
      const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:t=>t.parentElement?.closest('script,style,noscript,template')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
      const began=performance.now(),needle=norm(c.includes??c.excludes);let buffer='',t,found=false,complete=true;
      while((t=w.nextNode())){buffer=(buffer+' '+norm(t.textContent));if(buffer.includes(needle)){found=true;break;}buffer=buffer.slice(-Math.max(needle.length+100,1000));if(performance.now()-began>50){complete=false;break;}}
      return{kind:c.kind,ok:c.excludes!==undefined?!found&&complete:found,expected:c.includes??c.excludes,complete,reason:!complete?'coverage_incomplete':undefined};
    }
    const selectors={field:'input,textarea,[contenteditable="true"],[role="textbox"],[role="searchbox"]',checked:'input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"],[role="switch"]',selected:'select'};
    const candidates=document.querySelectorAll(c.selector||selectors[c.kind]||'a,button,input,textarea,select,[role]'),els=[];const began=performance.now();
    if(c.kind==='count')return{kind:c.kind,ok:(c.minCount===undefined||candidates.length>=c.minCount)&&(c.maxCount===undefined||candidates.length<=c.maxCount),actual:candidates.length};
    for(const e of candidates){if(performance.now()-began>50)return{kind:c.kind,ok:false,reason:'coverage_incomplete',complete:false};if(['field','checked','selected'].includes(c.kind)){const r=e.getBoundingClientRect(),style=getComputedStyle(e);if(r.width<=0||r.height<=0||style.visibility==='hidden'||style.display==='none'||e.closest('[aria-hidden="true"],[inert]'))continue;}if(c.label&&name(e)!==norm(c.label)||c.labelIncludes&&!name(e).includes(norm(c.labelIncludes)))continue;els.push(e);if(c.kind==='exists'||els.length>1)break;}
    if(c.kind==='exists')return{kind:c.kind,ok:els.length>0,count:els.length};
    if(els.length!==1)return{kind:c.kind,ok:false,count:els.length,label:c.label||c.labelIncludes};
    const e=els[0];let actual;
    if(c.kind==='checked')actual=e.checked??e.getAttribute('aria-checked')==='true';
    else if(c.kind==='selected')actual=Array.from(e.selectedOptions||[]).map(o=>o.label).join(', ');
    else if(c.kind==='field')actual='value'in e?e.value:e.textContent;
    else if(c.kind==='elementText')actual=norm(e.textContent);
    else if(c.kind==='attribute')actual=e.getAttribute(c.attribute);
    else return{kind:c.kind,ok:false,reason:'unsupported_check'};
    const ok=(c.notEmpty?norm(actual).length>0:c.includes!==undefined?String(actual).includes(String(c.includes)):norm(actual)===norm(c.equals))&&(c.maxLength===undefined||norm(actual).length<=c.maxLength);
    return{kind:c.kind,ok,label:c.label||c.labelIncludes,actual:c.sensitive?'[已隐藏]':actual,expected:c.sensitive?'[已隐藏]':c.equals??c.includes};
  });
  return{ok:details.length>0&&details.every(c=>c.ok),details,url:location.href,title:document.title,documentId:String(performance.timeOrigin),observedAt:new Date().toISOString()};
}

export function extractPage(specs) {
  const data={},coverage={},norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const boundedText=(root,limit)=>{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:t=>t.parentElement?.closest('script,style,noscript,template')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});const began=performance.now();let t,parts=[],size=0,truncated=false;while((t=w.nextNode())){const text=norm(t.textContent);if(text){parts.push(text.slice(0,limit-size));size+=text.length;}if(size>=limit||performance.now()-began>=50){truncated=true;break;}}return{value:parts.join(' ').slice(0,limit),truncated};};
  for(const spec of specs){
    if(spec.source==='url'){data[spec.name]=location.href;continue;}
    if(spec.source==='title'){data[spec.name]=document.title;continue;}
    if(spec.source==='section'){
      const heading=document.querySelector(spec.selector);if(!heading){data[spec.name]=null;coverage[spec.name]={matched:0,returned:0};continue;}
      const level=Number(heading.tagName.replace('H',''))||2,w=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT);w.currentNode=heading;let node,paragraphs=[],size=0,scanned=0,truncated=false;const began=performance.now(),limit=spec.maxChars||3000;
      while((node=w.nextNode())){if(/^H[1-6]$/.test(node.tagName)&&Number(node.tagName.slice(1))<=level)break;if(node.tagName==='P'&&!node.closest('figure,figcaption,aside')){const text=boundedText(node,limit-size);if(text.value){paragraphs.push(text.value);size+=text.value.length;}truncated||=text.truncated;if(paragraphs.length>=(spec.maxParagraphs||1)||size>=limit)break;}if(++scanned>=500||performance.now()-began>=50){truncated=true;break;}}
      data[spec.name]=paragraphs.length?paragraphs.join('\n'):null;coverage[spec.name]={paragraphs:paragraphs.length,scanned,truncated};continue;
    }
    const candidates=document.querySelectorAll(spec.selector||'body'),values=[],statuses=[];
    for(let i=0;i<Math.min(candidates.length,spec.all?(spec.maxItems||30):1);i++){const e=candidates[i];if(/password|one-time-code|cc-number|cc-csc/.test(e.autocomplete||'')||e.type==='password'){values.push('[已隐藏]');statuses.push({sensitive:true});}else if(spec.attribute){values.push(e.getAttribute(spec.attribute));statuses.push({truncated:false});}else{const text=boundedText(e,spec.maxChars||3000);values.push(text.value);statuses.push({truncated:text.truncated});}}
    data[spec.name]=spec.all?values:values[0]??null;
    coverage[spec.name]={matched:candidates.length,returned:values.length,truncated:spec.all&&candidates.length>values.length,items:statuses};
  }
  return{data,coverage,url:location.href,title:document.title,documentId:String(performance.timeOrigin),observedAt:new Date().toISOString()};
}
