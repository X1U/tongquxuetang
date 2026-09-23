'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createUpdateService}=require('../server/update-service.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'publication-1.20');
const json=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={completed:false,checkedAt:new Date().toISOString(),versionName:'1.20',versionCode:21};
const safe=value=>({available:value.available,versionName:value.versionName,versionCode:value.versionCode,source:value.source,installUrl:value.installUrl});
(async()=>{
  const record=json('.releases/pgyer/latest.json'),config=json('app-update.json');
  assert.equal(record.status,'published');assert.equal(record.installType,'public');
  assert.equal(record.artifact.versionName,'1.20');assert.equal(record.artifact.versionCode,'21');assert.equal(record.url,config.installUrl);
  const archivedApk=path.resolve(root,record.artifact.archivedApk);
  assert.equal(hash(archivedApk),record.artifact.apkSHA256);
  const verified=json('.checks/publication-1.20/apk-verification.json');
  assert.equal(verified.completed,true);assert.equal(verified.apkSHA256,record.artifact.apkSHA256);
  assert.equal(verified.pageSHA256,record.artifact.pageSHA256);
  assert.equal(verified.certificateSHA256,record.artifact.certificateSHA256);
  assert.equal(hash(path.join(root,'app/src/main/assets/index.html')),record.artifact.pageSHA256);
  const layout=json('.checks/publication-1.20/layout.json');assert.equal(layout.completed,true);assert.equal(layout.viewports.length,120);
  const previous=json('.releases/local/1.20/release.json');
  assert.equal(hash(path.join(root,'.releases/local/1.20/app.apk')),previous.apkSHA256);
  const results=await Promise.allSettled([createUpdateService(root)(),createUpdateService(root,{loadApiKey:async()=>''})()]);
  for(let i=0;i<results.length;i++){const result=results[i];report[['officialApi','publicPage'][i]]=result.status==='fulfilled'?safe(result.value):{available:false};}
  for(const name of ['officialApi','publicPage']){
    assert.equal(report[name].available,true,name+' unavailable');
    assert.equal(report[name].versionName,'1.20',name+' version mismatch');
    assert.equal(report[name].installUrl,record.url,name+' install link mismatch');
  }
  assert.equal(report.officialApi.source,'pgyer-api');assert.equal(report.officialApi.versionCode,21);assert.equal(report.publicPage.source,'public-page');
  report.build=record.buildBuildVersion;report.installUrl=record.url;report.publishedAt=record.publishedAt;
  report.apkSHA256=record.artifact.apkSHA256;report.archivedApk=record.artifact.archivedApk;
  report.publishedPackageMatchesVerifiedApk=true;report.originalLocalArchiveIntact=true;
  report.layoutStates=layout.viewports.length;report.androidPhysicalDeviceTested=false;report.completed=true;
})().catch(error=>{report.failure=error.name==='AssertionError'?error.message:'Publication verification did not complete';process.exitCode=1;}).finally(()=>{
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'publication.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
