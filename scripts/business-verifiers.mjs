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
