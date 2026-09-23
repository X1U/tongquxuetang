'use strict';
const path=require('node:path'),fs=require('node:fs');
const {createUpdateService}=require('../server/update-service.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const result=await createUpdateService(root)();
  const check={available:result.available,versionName:result.versionName,versionCode:result.versionCode,source:result.source,installUrl:result.installUrl};
  fs.writeFileSync(path.join(__dirname,'pgyer-update/live-check.json'),JSON.stringify(check,null,2));
  console.log(JSON.stringify(check));if(!result.available)process.exitCode=1;
})();
