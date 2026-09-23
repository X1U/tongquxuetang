'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {loadConfig,inspectApk}=require('../scripts/pgyer-release.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'speech-latency-1.18');
const read=name=>fs.readFileSync(path.join(root,name),'utf8'),json=name=>JSON.parse(read(name));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
  const artifact=await inspectApk(root,loadConfig(root));
  assert.equal(artifact.versionName,'1.18');assert.equal(String(artifact.versionCode),'19');
  const previous=json('.releases/local/1.17/release.json');assert.equal(artifact.certificateSHA256,previous.certificateSHA256);assert.equal(artifact.packageName,previous.packageName);
  assert.equal(sha(path.join(root,'.releases/local/1.17/app.apk')),previous.apkSHA256,'Previous APK archive stays intact');
  assert.equal(sha(path.join(root,'app/src/main/assets/index.html')),sha(path.resolve(root,'../密码图卡乐园/密码图卡乐园.html')));
  for(const name of ['手机预览.cjs','server/online-speech.cjs','server/speech-audio-cache.cjs'])assert.equal(sha(path.join(root,name)),sha(path.resolve(root,'../密码图卡乐园',name)),name+' is synchronized');
  const lint=read('app/build/reports/lint-results-debug.xml'),lintErrors=(lint.match(/severity="Error"/g)||[]).length,lintWarnings=(lint.match(/severity="Warning"/g)||[]).length;
  assert.equal(lintErrors,0,'Android compatibility checks pass');
  const build=read('.checks/speech-latency-1.18/android-build-final.log');assert.match(build,/BUILD SUCCESSFUL/);
  const reports={};
  for(const name of ['server','java','ui','live-server','live-java']){const report=json('.checks/speech-latency-1.18/'+name+'.json');assert.equal(report.completed,true,name+' checks complete');reports[name]=report;}
  assert.equal(reports.java.crossRuntimeCacheVerified,true);
  const global=json('.checks/global-voice-1.15/regression.json');assert.equal(global.completed,true);assert.deepEqual(global.errors,[]);assert.deepEqual(reports.ui.errors,[]);
  assert.equal(json('app/src/main/assets/online-voices.json').voices.length,14);
  const directory=path.join(root,'.releases/local/1.18'),apk=path.join(directory,'app.apk');fs.mkdirSync(directory,{recursive:true});
  if(fs.existsSync(apk))assert.equal(sha(apk),artifact.apkSHA256,'Never replace a different archived APK');else fs.copyFileSync(artifact.apkPath,apk);
  const release={releaseType:'local',published:false,createdAt:new Date().toISOString(),appName:'童趣学堂',packageName:artifact.packageName,versionName:artifact.versionName,versionCode:Number(artifact.versionCode),apk:'app.apk',bytes:artifact.bytes,apkSHA256:artifact.apkSHA256,pageSHA256:artifact.pageSHA256,certificateSHA256:artifact.certificateSHA256,notes:read('发布说明.txt').trim(),checks:{server:reports.server.checks.length,java:reports.java.checks.length,ui:reports.ui.checks.length,cachedPlaybackScenarios:reports.ui.cachedActivities.length,longPoemSegments:reports.ui.longPoemSegments,voiceEnginePaths:global.engines.length,liveJavaAndServerAudio:true,offlineRestartReuse:true,lintErrors,lintWarnings,signingCertificateUnchanged:true,webAndApkPageIdentical:true},androidPhysicalDeviceTested:false,acceptanceRecord:'../../../.checks/童趣学堂1.18验收.md'};
  fs.writeFileSync(path.join(directory,'release.json'),JSON.stringify(release,null,2)+'\n');
  const report={completed:true,...release,archivedApk:apk};fs.writeFileSync(path.join(out,'release-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
