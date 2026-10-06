import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGutenbergSearch,verifyGutenbergDetails} from '../scripts/business-verifiers.mjs';

test('搜索核验接受数组或逐条字段，拒绝部分完成、重复书目及缺失来源',()=>{
 const make=data=>({status:'verified',proof:{ok:true,url:'https://www.gutenberg.org/ebooks/search/?query=test'},data:{results:{data,coverage:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,{matched:Array.isArray(value)?value.length:1}]))}}});
 const arrays=make({titles:['First','Second','Third'],links:['/ebooks/1','/ebooks/2','/ebooks/3']});
 const scalars=make({title1:'First',url1:'/ebooks/1',title2:'Second',url2:'/ebooks/2',title3:'Third',url3:'/ebooks/3'});
 assert.equal(verifyGutenbergSearch(arrays,'test'),true);
 assert.equal(verifyGutenbergSearch(scalars,'test'),true);
 assert.equal(verifyGutenbergSearch(make({titles:['First','Second','Third']}),'test'),false);
 assert.equal(verifyGutenbergSearch(make({titles:['First','Second','Third'],links:['/ebooks/1','/ebooks/1','/ebooks/3']}),'test'),false);
 scalars.data.results.coverage.title1.matched=0;
 assert.equal(verifyGutenbergSearch(scalars,'test'),false);
 arrays.proof.url='https://example.test/ebooks/search/?query=test';
 assert.equal(verifyGutenbergSearch(arrays,'test'),false);
 arrays.proof.url='invalid';
 assert.equal(verifyGutenbergSearch(arrays,'test'),false);
});

test('详情核验拒绝导航混入、错书和截断，允许明确的格式缺项',()=>{
 const make=()=>({status:'verified',data:{discover:{url:'https://www.gutenberg.org/ebooks/search/?query=test',data:{titles:['A book'],links:['/ebooks/98']}},'detail-0':{url:'https://www.gutenberg.org/ebooks/98',data:{title:'A book by An Author',metadata:['Title A book','eBook-No. 98'],formatLabels:['Read online'],formatLinks:['/cache/epub/98/pg98-images.html']},coverage:{formatLabels:{matched:1,returned:1,truncated:false,items:[{truncated:false}]},formatLinks:{matched:1,returned:1,truncated:false,items:[{truncated:false}]}}}}});
 assert.equal(verifyGutenbergDetails(make(),{count:1}).passed,true);
 const navigation=make();navigation.data['detail-0'].data.formatLinks[0]='/ebooks/search/';assert.equal(verifyGutenbergDetails(navigation,{count:1}).passed,false);
 const wrong=make();wrong.data['detail-0'].data.metadata[1]='eBook-No. 99';assert.equal(verifyGutenbergDetails(wrong,{count:1}).passed,false);
 const truncated=make();truncated.data['detail-0'].coverage.formatLinks.truncated=true;assert.equal(verifyGutenbergDetails(truncated,{count:1}).passed,false);
 const missing=make();missing.data['detail-0'].data.formatLinks=[];missing.data['detail-0'].data.formatLabels=[];missing.data['detail-0'].coverage={formatLinks:{matched:0,returned:0},formatLabels:{matched:0,returned:0}};assert.equal(verifyGutenbergDetails(missing,{count:1}).passed,true);
 const unobserved=structuredClone(missing);unobserved.data['detail-0'].coverage={};assert.equal(verifyGutenbergDetails(unobserved,{count:1}).passed,false);
 const partial=make();partial.status='running';assert.equal(verifyGutenbergDetails(partial,{count:1}).passed,false);
});
