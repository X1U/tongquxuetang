'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createUpdateService}=require('../server/update-service.cjs');
const root=path.resolve(__dirname,'..'),recordFile=path.join(root,'.releases/pgyer/4bf292575af0163698cd567a/release.json');
const record=JSON.parse(fs.readFileSync(recordFile)),report={completed:false,checkedAt:new Date().toISOString(),versionName:'1.16',versionCode:17,build:record.buildBuildVersion,installUrl:record.url};
const safe=value=>({available:value.available,versionName:value.versionName,versionCode:value.versionCode,source:value.source,installUrl:value.installUrl});
(async()=>{
  assert.equal(record.status,'published');assert.equal(record.installType,'public');assert.equal(record.artifact.versionName,'1.16');assert.equal(record.artifact.versionCode,'17');
  const publishedApk=fs.readFileSync(path.resolve(root,record.artifact.archivedApk));
  assert.equal(crypto.createHash('sha256').update(publishedApk).digest('hex'),record.artifact.apkSHA256);
  assert.equal(record.artifact.apkSHA256,JSON.parse(fs.readFileSync(path.join(root,'.releases/local/1.16/release.json'))).apkSHA256);
  const results=await Promise.allSettled([
    createUpdateService(root)(),
    createUpdateService(root,{loadApiKey:async()=>''})(),
    fetch('http://127.0.0.1:8765/api/app/update',{signal:AbortSignal.timeout(15000)}).then(response=>response.json())
  ]);
  for(let index=0;index<results.length;index++){
    const result=results[index],name=['officialApi','publicPage','previewUpdate'][index];
    report[name]=result.status==='fulfilled'?safe(result.value):{available:false};
  }
  for(const name of ['officialApi','publicPage','previewUpdate']){
    assert.equal(report[name].available,true,name+' unavailable');assert.equal(report[name].versionName,'1.16',name+' version mismatch');assert.equal(report[name].installUrl,record.url,name+' install link mismatch');
  }
  assert.equal(report.officialApi.source,'pgyer-api');assert.equal(report.officialApi.versionCode,17);assert.equal(report.publicPage.source,'public-page');
  report.archivedApkMatchesTestedPackage=true;report.publishedAt=record.publishedAt;report.recordFile=path.relative(root,recordFile);report.completed=true;
})().catch(()=>{process.exitCode=1;}).finally(()=>{
  fs.writeFileSync(path.join(__dirname,'online-voice-1.16/publication.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
