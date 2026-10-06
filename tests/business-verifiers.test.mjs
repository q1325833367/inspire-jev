import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGutenbergSearch} from '../scripts/business-verifiers.mjs';

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
