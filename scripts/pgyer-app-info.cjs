'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function main(){
  const key=process.env.PGYER_API_KEY?.trim();
  if(!key){console.log(JSON.stringify({configured:false,found:false}));return;}
  const packageName=JSON.parse(fs.readFileSync(path.join(root,'pgyer.publish.json'),'utf8')).packageName;
  async function api(endpoint,values){
    const response=await fetch('https://www.pgyer.com/apiv2/app/'+endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_api_key:key,...values}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('HTTP_'+response.status);
    const json=await response.json();if(json.code!==0)throw Error('PGYER_'+Number(json.code));return json.data;
  }
  let matches=[];
  for(let page=1;page<=20;page++){
    const result=await api('listMy',{page:String(page)}),list=Array.isArray(result)?result:result?.list;
    if(!Array.isArray(list))throw Error('INVALID_RESPONSE');
    matches.push(...list.filter(app=>app.buildIdentifier===packageName&&Number(app.buildType)===2));
    if(!list.length)break;
  }
  matches=[...new Map(matches.map(app=>[app.appKey,app])).values()];
  const apps=[];
  for(const app of matches){
    const details=await api('view',{appKey:app.appKey});
    const shortcut=String(details.buildShortcutUrl||'');
    apps.push({appKey:app.appKey,packageName:details.buildIdentifier,name:details.buildName,versionName:details.buildVersion,versionCode:Number(details.buildVersionNo),installUrl:/^[\w-]+$/.test(shortcut)?'https://www.pgyer.com/'+shortcut:null});
  }
  const info={configured:true,found:apps.length>0,apps};
  fs.mkdirSync(path.join(root,'.checks/pgyer-update'),{recursive:true});fs.writeFileSync(path.join(root,'.checks/pgyer-update/app-info.json'),JSON.stringify(info,null,2));
  console.log(JSON.stringify(info));
}
main().catch(error=>{console.error('蒲公英应用查询失败：'+(/^(HTTP_|PGYER_|INVALID_RESPONSE)/.test(error.message)?error.message:'NETWORK_UNAVAILABLE'));process.exitCode=1;});
