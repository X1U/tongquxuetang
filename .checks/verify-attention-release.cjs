'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {lessons}=require('../scripts/build-attention.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'attention-1.20');
const read=file=>fs.readFileSync(path.join(root,file),'utf8'),json=file=>JSON.parse(read(file));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const artifact=json('.checks/attention-1.20/apk-verification.json');
assert.ok(artifact.completed&&artifact.updateMetadataMatches&&artifact.standaloneMatches);
assert.equal(artifact.versionName,'1.20');assert.equal(artifact.versionCode,'21');
assert.equal(sha(artifact.apkPath),artifact.apkSHA256);
assert.equal(sha(path.join(root,'app/src/main/assets/index.html')),artifact.pageSHA256);
assert.equal(sha(path.resolve(root,'../密码图卡乐园/密码图卡乐园.html')),artifact.pageSHA256);
const html=read('app/src/main/assets/index.html'),data=lessons();
assert.deepEqual(JSON.parse(html.match(/window\.AttentionLessons=([^\n]+);/)[1]),data);
assert.equal((html.match(/data-open-mode="/g)||[]).length,9);
const reports={};
for(const name of ['regression','layout','audio','listening/regression','updates/ui']){
  const file='.checks/attention-1.20/'+name+'.json';reports[name]=json(file);assert.equal(reports[name].completed,true,file);
}
assert.equal(reports.regression.cards,24);assert.equal(reports.regression.questions,96);
const lint=read('app/build/reports/lint-results-debug.xml'),lintErrors=(lint.match(/severity="Error"/g)||[]).length,lintWarnings=(lint.match(/severity="Warning"/g)||[]).length;
assert.equal(lintErrors,0);assert.match(read('.checks/attention-1.20/android-build.log'),/BUILD SUCCESSFUL/);
const previous=json('.releases/pgyer/latest.json');
assert.equal(previous.artifact.versionName,'1.19');assert.equal(previous.status,'published');
assert.equal(previous.artifact.certificateSHA256,artifact.certificateSHA256);assert.equal(previous.artifact.packageName,artifact.packageName);
assert.equal(sha(path.resolve(root,previous.artifact.archivedApk)),previous.artifact.apkSHA256,'Keep the published 1.19 archive intact');
const directory=path.join(root,'.releases/local/1.20'),apk=path.join(directory,'app.apk'),recordPath=path.join(directory,'release.json');
fs.mkdirSync(directory,{recursive:true});
if(fs.existsSync(apk))assert.equal(sha(apk),artifact.apkSHA256,'Never replace a different archived APK');else fs.copyFileSync(artifact.apkPath,apk);
assert.equal(sha(apk),artifact.apkSHA256);
let createdAt=new Date().toISOString();
if(fs.existsSync(recordPath)){const existing=JSON.parse(fs.readFileSync(recordPath,'utf8'));assert.equal(existing.apkSHA256,artifact.apkSHA256);createdAt=existing.createdAt;}
const release={releaseType:'local',published:false,createdAt,appName:artifact.appName,packageName:artifact.packageName,versionName:artifact.versionName,versionCode:Number(artifact.versionCode),apk:'app.apk',bytes:artifact.bytes,apkSHA256:artifact.apkSHA256,pageSHA256:artifact.pageSHA256,certificateSHA256:artifact.certificateSHA256,notes:read('发布说明.txt').trim(),checks:{cards:data.cards.length,questions:data.cards.reduce((total,card)=>total+card.questions.length,0),uiGroups:reports.regression.checks.length,layoutStates:reports.layout.viewports.length,viewports:new Set(reports.layout.viewports.map(item=>item.width+'x'+item.height)).size,audioGroups:reports.audio.checks.length,legacyListeningGroups:reports['listening/regression'].checks.length,updateScenarios:reports['updates/ui'].scenarios.length,lintErrors,lintWarnings,signingCertificateUnchanged:true,webAndApkPageIdentical:true,previousPublishedArchiveIntact:true},androidPhysicalDeviceTested:false,acceptanceRecord:'../../../.checks/童趣学堂1.20验收.md'};
fs.writeFileSync(recordPath,JSON.stringify(release,null,2)+'\n');
fs.writeFileSync(path.join(out,'release-verification.json'),JSON.stringify({completed:true,...release,archivedApk:apk},null,2)+'\n');
console.log(JSON.stringify({completed:true,version:release.versionName,bytes:release.bytes,apkSHA256:release.apkSHA256,checks:release.checks,published:release.published,archivedApk:apk}));
