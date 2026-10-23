'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{createUpdateService}=require('../server/update-service.cjs');
const json=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.resolve(root,file))).digest('hex');
const report={completed:false,checkedAt:new Date().toISOString(),versionName:'1.23',versionCode:24};
const safe=value=>({available:value.available,versionName:value.versionName,versionCode:value.versionCode,source:value.source,installUrl:value.installUrl});
(async()=>{
  const record=json('.releases/pgyer/latest.json'),layout=json('.checks/home-ui-1.23/layout.json');
  assert.equal(record.status,'published');assert.equal(record.installType,'public');assert.equal(record.artifact.versionName,'1.23');assert.equal(record.artifact.versionCode,'24');
  assert.equal(hash(record.artifact.apkPath),record.artifact.apkSHA256);assert.equal(hash(record.artifact.archivedApk),record.artifact.apkSHA256);
  assert.equal(hash('app/src/main/assets/index.html'),record.artifact.pageSHA256);
  assert.equal(layout.completed,true);assert.equal(layout.screens.length,13);assert.deepEqual(layout.errors,[]);
  for(const screen of layout.screens){
    assert.equal(screen.cards.length,10);const left=screen.cards.find(c=>c.mode==='attention'),right=screen.cards.find(c=>c.mode==='tangram');
    assert.equal(left.title,'听觉训练卡');assert.ok(Math.abs(left.rect.y-right.rect.y)<1&&left.rect.right<=right.rect.x);
    assert.equal(left.font,screen.cards[0].font);assert.equal(left.padding,screen.cards[0].padding);assert.equal(left.flow,screen.cards[0].flow);
    assert.ok(screen.cards.every(c=>c.rect.height>=44&&c.rect.right<=screen.width+1&&c.rect.bottom<=screen.height+1));
  }
  const results=await Promise.allSettled([createUpdateService(root)(),createUpdateService(root,{loadApiKey:async()=>''})()]);
  for(let i=0;i<results.length;i++)report[['officialApi','publicPage'][i]]=results[i].status==='fulfilled'?safe(results[i].value):{available:false};
  for(const name of ['officialApi','publicPage']){assert.equal(report[name].available,true);assert.equal(report[name].versionName,'1.23');assert.equal(report[name].installUrl,record.url);}
  assert.equal(report.officialApi.source,'pgyer-api');assert.equal(report.officialApi.versionCode,24);assert.equal(report.publicPage.source,'public-page');
  report.build=record.buildBuildVersion;report.installUrl=record.url;report.publishedAt=record.publishedAt;report.archivedApk=record.artifact.archivedApk;
  report.apkSHA256=record.artifact.apkSHA256;report.pageSHA256=record.artifact.pageSHA256;report.viewports=layout.screens.length;
  report.androidPhysicalDeviceTested=false;report.completed=true;
})().catch(error=>{report.failure=error.name==='AssertionError'?error.message:'Publication verification did not complete';process.exitCode=1;}).finally(()=>{
  fs.writeFileSync(path.join(__dirname,'home-ui-1.23/publication.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
