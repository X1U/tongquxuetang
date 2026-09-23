'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function releaseInfo(){
  const gradle=fs.readFileSync(path.join(root,'app/build.gradle'),'utf8');
  const source=JSON.parse(fs.readFileSync(path.join(root,'app-update.json'),'utf8'));
  const info={packageName:gradle.match(/applicationId\s+"([^"]+)"/)[1],versionName:gradle.match(/versionName\s+"([^"]+)"/)[1],versionCode:Number(gradle.match(/versionCode\s+(\d+)/)[1]),appKey:source.appKey,installUrl:source.installUrl,notes:fs.readFileSync(path.join(root,'发布说明.txt'),'utf8').trim()};
  assert.equal(source.packageName,info.packageName);
  assert.match(info.versionName,/^\d+(?:\.\d+)*$/,'Public update checks require numeric release names');
  assert.match(info.appKey,/^[a-f0-9]{20,40}$/);
  assert.match(info.installUrl,/^https:\/\/www\.pgyer\.com\/[A-Za-z0-9_-]+$/);
  return info;
}
function injectUpdates(html){
  const info=releaseInfo(),read=name=>fs.readFileSync(path.join(root,'modules/updates',name),'utf8');
  for(const type of ['styles','home','dialog','scripts'])html=html.replace(new RegExp('\\n[ \\t]*<!-- updates:'+type+':start -->[\\s\\S]*?<!-- updates:'+type+':end -->\\n','g'),'');
  const block=(type,content)=>'\n  <!-- updates:'+type+':start -->\n'+content+'\n  <!-- updates:'+type+':end -->\n';
  assert.ok(html.includes('<p class="home-note">')&&html.includes('<script id="mode-router">'));
  html=html.replace('</head>',block('styles','<style id="update-styles">\n'+read('styles.css')+'\n</style>')+'</head>');
  html=html.replace('<p class="home-note">',block('home',read('view.html'))+'<p class="home-note">');
  html=html.replace('  <script id="mode-router">',block('dialog',read('dialog.html'))+block('scripts','<script id="app-updates">\nwindow.AppRelease='+JSON.stringify(info).replace(/</g,'\\u003c')+';\n'+read('app.js')+'\n</script>')+'  <script id="mode-router">');
  fs.writeFileSync(path.join(root,'app/src/main/assets/app-update.json'),JSON.stringify(info,null,2)+'\n','utf8');
  return html;
}
module.exports={releaseInfo,injectUpdates};
