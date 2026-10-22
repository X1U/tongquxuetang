'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createUpdateService}=require('../server/update-service.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'publication-1.22');
const json=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const report={completed:false,checkedAt:new Date().toISOString(),versionName:'1.22',versionCode:23};
const safe=value=>({available:value.available,versionName:value.versionName,versionCode:value.versionCode,source:value.source,installUrl:value.installUrl});
(async()=>{
  const record=json('.releases/pgyer/latest.json'),config=json('app-update.json'),regression=json('.checks/tangram-1.22/report.json');
  assert.equal(record.status,'published');assert.equal(record.installType,'public');
  assert.equal(record.artifact.versionName,'1.22');assert.equal(record.artifact.versionCode,'23');
  assert.equal(record.artifact.packageName,config.packageName);assert.equal(record.url,config.installUrl);
  assert.equal(record.notes,fs.readFileSync(path.join(root,'发布说明.txt'),'utf8').trim());
  assert.equal(hash('app/build/outputs/apk/debug/app-debug.apk'),record.artifact.apkSHA256);
  assert.equal(hash(record.artifact.archivedApk),record.artifact.apkSHA256);
  assert.equal(hash('app/src/main/assets/index.html'),record.artifact.pageSHA256);
  assert.equal(record.artifact.certificateSHA256,json('pgyer.publish.json').certificateSHA256);
  assert.equal(regression.completed,true);assert.equal(regression.levels.length,24);assert.equal(regression.viewports.length,8);assert.deepEqual(regression.errors,[]);
  const results=await Promise.allSettled([createUpdateService(root)(),createUpdateService(root,{loadApiKey:async()=>''})()]);
  for(let i=0;i<results.length;i++)report[['officialApi','publicPage'][i]]=results[i].status==='fulfilled'?safe(results[i].value):{available:false};
  for(const name of ['officialApi','publicPage']){
    assert.equal(report[name].available,true,name+' unavailable');
    assert.equal(report[name].versionName,'1.22',name+' version mismatch');
    assert.equal(report[name].installUrl,record.url,name+' install link mismatch');
  }
  assert.equal(report.officialApi.source,'pgyer-api');assert.equal(report.officialApi.versionCode,23);assert.equal(report.publicPage.source,'public-page');
  report.build=record.buildBuildVersion;report.installUrl=record.url;report.publishedAt=record.publishedAt;
  report.apkSHA256=record.artifact.apkSHA256;report.archivedApk=record.artifact.archivedApk;
  report.publishedPackageMatchesVerifiedApk=true;report.levels=regression.levels.length;report.viewports=regression.viewports.length;
  report.androidPhysicalDeviceTested=false;report.completed=true;
})().catch(error=>{report.failure=error.name==='AssertionError'?error.message:'Publication verification did not complete';process.exitCode=1;}).finally(()=>{
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'publication.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
