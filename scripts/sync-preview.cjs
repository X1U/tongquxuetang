'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),target=path.resolve(root,'../密码图卡乐园');
assert.ok(fs.existsSync(path.join(target,'密码图卡乐园.html')),'Standalone preview folder must already exist');
assert.ok(fs.existsSync(path.join(root,'tools/online-speech/node_modules/node-edge-tts/package.json')),'Run npm ci --prefix tools/online-speech before syncing the preview');
const files=['手机预览.cjs','app-update.json','server/page-response.cjs','server/speech-service.cjs','server/speech-worker.ps1','server/update-service.cjs','server/online-speech.cjs','server/speech-audio-cache.cjs','server/online-voices.json','tools/online-speech/package.json','tools/online-speech/package-lock.json'];
// Copy files explicitly for compatibility with Windows directory-copy helpers.
function copyDirectory(source,destination){
  fs.mkdirSync(destination,{recursive:true});let count=0;
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    const from=path.join(source,entry.name),to=path.join(destination,entry.name);
    if(entry.isDirectory())count+=copyDirectory(from,to);
    else if(entry.isFile()){fs.copyFileSync(from,to);count++;}
    else throw new Error('Dependency must be a regular file or directory: '+entry.name);
  }
  return count;
}
for(const relative of files){
  const destination=path.join(target,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,relative),destination);
}
fs.copyFileSync(path.join(root,'app/src/main/assets/index.html'),path.join(target,'密码图卡乐园.html'));
const dependencyFiles=copyDirectory(path.join(root,'tools/online-speech/node_modules'),path.join(target,'tools/online-speech/node_modules'));
fs.copyFileSync(path.join(root,'content/voices/third-party-notices.txt'),path.join(target,'server/online-voice-notices.txt'));
console.log(JSON.stringify({synced:true,files:files.length+2,dependencyFiles,destination:target,onlineDependencies:true}));
