'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),mirror=path.resolve(root,'../密码图卡乐园'),out=path.join(__dirname,'online-voice-1.16');
const read=name=>fs.readFileSync(path.join(root,name)),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function entries(buffer){
  let end=buffer.length-22;while(end>=0&&buffer.readUInt32LE(end)!==0x06054b50)end--;
  assert.ok(end>=0);let offset=buffer.readUInt32LE(end+16);const files=new Map();
  for(let i=0;i<buffer.readUInt16LE(end+10);i++){
    const nameLength=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32),name=buffer.toString('utf8',offset+46,offset+46+nameLength),local=buffer.readUInt32LE(offset+42),size=buffer.readUInt32LE(offset+20),method=buffer.readUInt16LE(offset+10);
    const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),compressed=buffer.subarray(start,start+size);assert.ok([0,8].includes(method));files.set(name,method===8?zlib.inflateRawSync(compressed):compressed);offset+=46+nameLength+extra+comment;
  }
  return files;
}
function compare(relative){assert.equal(sha(read(relative)),sha(fs.readFileSync(path.join(mirror,relative))),relative+' differs in standalone preview');}
function compareDirectory(relative){let count=0;for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const child=path.join(relative,entry.name);if(entry.isDirectory())count+=compareDirectory(child);else if(entry.isFile()){compare(child);count++;}else assert.fail('Unexpected dependency link');}return count;}
const apk=read('app/build/outputs/apk/debug/app-debug.apk'),files=entries(apk),catalog=JSON.parse(read('content/voices/online-voices.json'));
const artifact=JSON.parse(read('.checks/pgyer-update/apk-verification.json'));
assert.equal(artifact.apkSHA256,sha(apk));assert.equal(artifact.versionName,'1.16');assert.equal(artifact.versionCode,'17');
assert.equal(artifact.certificateSHA256,JSON.parse(read('.releases/local/1.15/release.json')).certificateSHA256);
assert.deepEqual(files.get('assets/index.html'),read('app/src/main/assets/index.html'));
assert.deepEqual(JSON.parse(files.get('assets/online-voices.json')),catalog);assert.equal(catalog.voices.length,14);
assert.deepEqual(files.get('assets/online-voice-notices.txt'),read('content/voices/third-party-notices.txt'));
const dex=[...files].filter(([name])=>/^classes\d*\.dex$/.test(name)).map(([,bytes])=>bytes);
const classes=['Lcom/picturecard/learning/OnlineSpeech;','Lcom/picturecard/learning/OnlineSpeechProtocol;','Lokhttp3/OkHttpClient;','Lokio/ByteString;'];
for(const name of classes)assert.ok(dex.some(bytes=>bytes.includes(Buffer.from(name))),'Missing native class: '+name);
assert.ok(['utf8','utf16le'].some(encoding=>files.get('AndroidManifest.xml').includes(Buffer.from('android.permission.INTERNET',encoding))));
const previewFiles=['手机预览.cjs','app-update.json','server/page-response.cjs','server/speech-service.cjs','server/speech-worker.ps1','server/update-service.cjs','server/online-speech.cjs','server/online-voices.json','tools/online-speech/package.json','tools/online-speech/package-lock.json'];
previewFiles.forEach(compare);const dependencies=compareDirectory('tools/online-speech/node_modules');
const {OnlineSpeech}=require(path.join(mirror,'server/online-speech.cjs')),standalone=new OnlineSpeech(mirror);assert.deepEqual(standalone.voices,catalog.voices);standalone.close();
assert.equal(sha(files.get('assets/index.html')),sha(fs.readFileSync(path.join(mirror,'密码图卡乐园.html'))));
for(const name of ['audio','preview','recovery'])assert.equal(JSON.parse(fs.readFileSync(path.join(out,name+'.json'))).completed,true);
const browser=JSON.parse(fs.readFileSync(path.join(out,'preview.json')));assert.equal(browser.voices.length,14);assert.equal(browser.activities.length,9);assert.deepEqual(browser.httpErrors.filter(error=>!error.intentional),[]);
for(const [source,target] of [['.checks/global-voice-1.15/regression.json','global-voice.json'],['.checks/listening-1.14/layout.json','layout.json'],['.checks/pgyer-update/regression.json','updates.json'],['.checks/pgyer-update/apk-verification.json','apk.json']]){
  const bytes=read(source),report=JSON.parse(bytes);assert.equal(report.completed,true);fs.writeFileSync(path.join(out,target),bytes);
}
const report={completed:true,version:'1.16',versionCode:17,apkSHA256:artifact.apkSHA256,certificateMatches115:true,bundledOnlineVoices:catalog.voices.length,nativeClasses:classes,networkPermission:true,bundledLicenseMatches:true,standaloneFilesMatched:previewFiles.length,dependencyFilesMatched:dependencies,standaloneServiceLoads:true,realBrowserVoices:browser.voices.length,realBrowserActivities:browser.activities.length,unexpectedOnlineErrors:0,androidPhysicalDeviceTested:false};
fs.writeFileSync(path.join(out,'release-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
