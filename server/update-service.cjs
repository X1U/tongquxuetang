'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile),MAX_BYTES=256*1024;
// Load only the named credential; never enumerate, log, or expose environment values.
async function loadApiKey(){
  if(process.env.PGYER_API_KEY?.trim())return process.env.PGYER_API_KEY.trim();
  if(process.platform!=='win32')return '';
  try{
    const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"foreach ($updateScope in @('User','Machine')) { $updateValue = [Environment]::GetEnvironmentVariable('PGYER_API_KEY', $updateScope); if (-not [string]::IsNullOrWhiteSpace($updateValue)) { [Console]::Write($updateValue); break } }"],{windowsHide:true,timeout:3500,maxBuffer:8192});
    return stdout.trim();
  }catch(_){return '';}
}
async function readBounded(response){
  if(!response.ok)throw new Error('UPDATE_UNAVAILABLE');
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('UPDATE_UNAVAILABLE');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw new Error('UPDATE_UNAVAILABLE');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
function publicVersion(html,config){
  const field=name=>new RegExp('\\b'+name+'\\s*=\\s*[\'\"]([^\'\"]{1,80})[\'\"]').exec(html)?.[1];
  const versionName=field('aVersion');
  if(field('agKey')!==config.appKey||field('aType')!=='android'||!/^\d+(?:\.\d+)*$/.test(versionName||''))throw new Error('UPDATE_UNAVAILABLE');
  return {available:true,appKey:config.appKey,packageName:config.packageName,versionName,versionCode:null,notes:'',installUrl:config.installUrl,source:'public-page'};
}
function createUpdateService(root,options={}){
  const config=JSON.parse(fs.readFileSync(path.join(root,'app-update.json'),'utf8'));
  if(!/^https:\/\/www\.pgyer\.com\/[A-Za-z0-9_-]+$/.test(config.installUrl)||!/^[a-f0-9]{20,40}$/.test(config.appKey))throw new Error('Invalid public update configuration');
  const request=options.fetch||fetch,credential=options.loadApiKey||loadApiKey,now=options.now||Date.now;
  let cached=null,cachedAt=0,loading=null;
  async function query(){
    const key=await credential();
    if(key){
      const response=await request('https://www.pgyer.com/apiv2/app/check',{method:'POST',body:new URLSearchParams({_api_key:key,appKey:config.appKey}),redirect:'error',signal:AbortSignal.timeout(9000)});
      const payload=JSON.parse(await readBounded(response)),data=payload.data;
      if(payload.code!==0||!data||data.appKey!==config.appKey||(data.buildIdentifier&&data.buildIdentifier!==config.packageName)||typeof data.buildVersion!=='string'||!/^\d+(?:\.\d+)*$/.test(data.buildVersion))throw new Error('UPDATE_UNAVAILABLE');
      const code=Number(data.buildVersionNo);
      if(!Number.isSafeInteger(code)||code<1)throw new Error('UPDATE_UNAVAILABLE');
      // Only these fields leave this module. In particular, downloadURL may contain the API key.
      const notes=typeof data.buildUpdateDescription==='string'?data.buildUpdateDescription.split(key).join('[已隐藏]').slice(0,4000):'';
      return {available:true,appKey:config.appKey,packageName:config.packageName,versionName:data.buildVersion,versionCode:code,notes,installUrl:config.installUrl,source:'pgyer-api'};
    }
    const response=await request(config.installUrl,{redirect:'error',headers:{'User-Agent':'PictureCardLearning/UpdateCheck','Accept':'text/html'},signal:AbortSignal.timeout(9000)});
    return publicVersion(await readBounded(response),config);
  }
  return async()=>{
    if(cached&&now()-cachedAt<(cached.available?60000:10000))return cached;
    if(!loading)loading=query().catch(()=>({available:false,code:'UPDATE_UNAVAILABLE',message:'暂时无法检查，可重试或打开安装页。',installUrl:config.installUrl})).then(value=>{cached=value;cachedAt=now();return value;}).finally(()=>{loading=null;});
    return loading;
  };
}
module.exports={createUpdateService,publicVersion,readBounded};
