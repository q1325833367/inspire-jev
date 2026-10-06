import {installEntries} from '../src/lifecycle.mjs';
const index=process.argv.indexOf('--entry');
console.log(JSON.stringify(await installEntries({entry:index<0?'all':process.argv[index+1]}),null,2));
