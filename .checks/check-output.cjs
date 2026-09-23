'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
function directory(fallback){
  const index=process.argv.indexOf('--output'),value=index<0?fallback:process.argv[index+1];
  assert.ok(value&&!value.startsWith('--'),'--output needs a directory relative to .checks');
  const target=path.resolve(__dirname,value),relative=path.relative(__dirname,target);
  assert.ok(relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep),'Keep verification reports inside .checks');
  return target;
}
module.exports={directory};
