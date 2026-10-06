// Checks the business data, independent of the model's choice of output field names.
export function verifyGutenbergSearch(result,query){
  if(result?.status!=='verified'||result.proof?.ok!==true)return false;
  let url;try{url=result.proof.url?new URL(result.proof.url):null;}catch{return false;}
  if(url?.origin!=='https://www.gutenberg.org'||url.pathname!=='/ebooks/search/'||url.searchParams.get('query')!==query)return false;
  const isBookLink=value=>{try{const u=new URL(value,url);return typeof value==='string'&&u.origin===url.origin&&/^\/ebooks\/\d+$/.test(u.pathname);}catch{return false;}};
  const isText=value=>typeof value==='string'&&value.trim()&&!isBookLink(value)&&!/^https?:/.test(value);
  return Object.values(result.data||{}).some(stage=>{
    const values=Object.entries(stage.data||{}).filter(([name])=>stage.coverage?.[name]?.matched>0).map(([,value])=>value);
    const arrays=values.filter(Array.isArray);
    const distinctLinks=items=>items.length===3&&items.every(isBookLink)&&new Set(items.map(x=>new URL(x,url).href)).size===3;
    const arrayPair=arrays.some(distinctLinks)&&arrays.some(items=>items.length===3&&items.every(isText));
    const scalars=values.filter(value=>!Array.isArray(value));
    const scalarPair=distinctLinks(scalars.filter(isBookLink))&&scalars.filter(isText).length===3;
    return arrayPair||scalarPair;
  });
}

export function verifyGutenbergDetails(result,{count,prefix='detail-',firstIndex=0,matchTitles=true}={}){
  const found=result?.data?.discover,failures=[],books=[];
  if(result?.status!=='verified'||!Number.isInteger(count)||count<1||found?.data?.links?.length!==count||found?.data?.titles?.length!==count)return{passed:false,failures:['incomplete_discovery'],books};
  const seen=new Set();
  for(let i=0;i<count;i++){
    const stage=result.data[`${prefix}${i+firstIndex}`];
    let expected;try{expected=new URL(found.data.links[i],found.url);}catch{failures.push(`invalid_source:${i+1}`);continue;}
    const id=expected.pathname.match(/^\/ebooks\/(\d+)$/)?.[1];
    const labels=stage?.data?.formatLabels,links=stage?.data?.formatLinks;
    const identified=id&&expected.origin==='https://www.gutenberg.org'&&stage?.url===expected.href&&!seen.has(expected.href)&&Array.isArray(stage.data.metadata)&&stage.data.metadata.includes(`eBook-No. ${id}`)&&stage.data.metadata.some(row=>/^Title\s+\S/.test(row))&&(!matchTitles||stage.data.metadata.includes(`Title ${found.data.titles[i]}`))&&!!stage.data.title?.trim();
    const formats=Array.isArray(labels)&&Array.isArray(links)&&labels.length===links.length&&stage.coverage?.formatLinks?.matched===links.length&&stage.coverage?.formatLinks?.returned===links.length&&stage.coverage?.formatLabels?.matched===labels.length&&stage.coverage?.formatLabels?.returned===labels.length&&stage.coverage.formatLinks.truncated!==true&&stage.coverage.formatLabels.truncated!==true&&links.every((href,j)=>{
      try{const u=new URL(href,stage.url);return u.origin===expected.origin&&(u.pathname.startsWith(`/cache/epub/${id}/`)||u.pathname.startsWith(`/ebooks/${id}.`))&&!!labels[j]?.trim()&&!stage.coverage.formatLinks.items?.[j]?.truncated&&!stage.coverage.formatLabels.items?.[j]?.truncated;}catch{return false;}
    });
    if(!identified)failures.push(`book_identity:${i+1}`);
    if(!formats)failures.push(`reading_formats:${i+1}`);
    seen.add(expected.href);
    books.push({position:i+1,url:stage?.url,expectedUrl:expected.href,title:stage?.data?.title,formatCount:links?.length||0,formatStatus:links?.length?'已发现':'缺项：未发现阅读格式链接',identified:Boolean(identified),formatsVerified:Boolean(formats)});
  }
  return{passed:failures.length===0&&books.length===count,failures,books};
}
