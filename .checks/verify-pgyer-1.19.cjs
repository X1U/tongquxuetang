'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createUpdateService}=require('../server/update-service.cjs');
const root=path.resolve(__dirname,'..'),record=JSON.parse(fs.readFileSync(path.join(root,'.releases/pgyer/latest.json')));
const config=JSON.parse(fs.readFileSync(path.join(root,'app-update.json')));
const report={completed:false,checkedAt:new Date().toISOString(),versionName:'1.19',versionCode:20,build:record.buildBuildVersion,installUrl:record.url};
const safe=value=>({available:value.available,versionName:value.versionName,versionCode:value.versionCode,source:value.source,installUrl:value.installUrl});
(async()=>{
  assert.equal(record.status,'published');assert.equal(record.installType,'public');assert.equal(record.artifact.versionName,'1.19');assert.equal(record.artifact.versionCode,'20');assert.equal(record.url,config.installUrl);
  const publishedApk=fs.readFileSync(path.resolve(root,record.artifact.archivedApk));
  assert.equal(crypto.createHash('sha256').update(publishedApk).digest('hex'),record.artifact.apkSHA256);
  const verified=JSON.parse(fs.readFileSync(path.join(__dirname,'pgyer-update/apk-verification.json')));
  assert.equal(verified.completed,true);assert.equal(verified.apkSHA256,record.artifact.apkSHA256);
  const results=await Promise.allSettled([createUpdateService(root)(),createUpdateService(root,{loadApiKey:async()=>''})()]);
  for(let i=0;i<results.length;i++){const result=results[i];report[['officialApi','publicPage'][i]]=result.status==='fulfilled'?safe(result.value):{available:false};}
  for(const name of ['officialApi','publicPage']){assert.equal(report[name].available,true,name+' unavailable');assert.equal(report[name].versionName,'1.19',name+' version mismatch');assert.equal(report[name].installUrl,record.url,name+' install link mismatch');}
  assert.equal(report.officialApi.source,'pgyer-api');assert.equal(report.officialApi.versionCode,20);assert.equal(report.publicPage.source,'public-page');
  report.publishedPackageMatchesVerifiedApk=true;report.publishedAt=record.publishedAt;report.apkSHA256=record.artifact.apkSHA256;report.archivedApk=record.artifact.archivedApk;report.completed=true;
})().catch(error=>{report.failure=error.name==='AssertionError'?error.message:'Publication verification did not complete';process.exitCode=1;}).finally(()=>{
  fs.writeFileSync(path.join(__dirname,'publication-1.19/publication.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
