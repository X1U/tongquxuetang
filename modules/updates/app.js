(() => {
  'use strict';
  const $=id=>document.getElementById(id),config=window.AppRelease;
  const native=window.AppUpdates,dialog=$('updateDialog'),cacheKey='picture-learning-updates-v1';
  const inApp=!!native&&['downloadUpdate','cancelDownload','installUpdate','downloadState'].every(name=>typeof native[name]==='function');
  const stages=new Set(['idle','restoring','preparing','downloading','verifying','ready','permission','installing','error','cancelled']);
  let current={versionName:config.versionName,versionCode:config.versionCode},result=null,pending=null,serial=0,lastChecked=0;
  let download={state:'idle',message:'',downloaded:0,total:-1,versionName:''},commandPending=false,commandTimer;
  try{if(native&&typeof native.currentVersion==='function'){const info=JSON.parse(native.currentVersion());if(info.packageName===config.packageName&&typeof info.versionName==='string'&&Number.isSafeInteger(info.versionCode))current=info;}}catch(_){}
  function compareNames(left,right){
    if(!/^\d+(?:\.\d+)*$/.test(left)||!/^\d+(?:\.\d+)*$/.test(right))return null;
    const a=left.split('.'),b=right.split('.');
    for(let i=0;i<Math.max(a.length,b.length);i++){
      const x=(a[i]||'0').replace(/^0+(?=\d)/,''),y=(b[i]||'0').replace(/^0+(?=\d)/,'');
      if(x!==y)return x.length!==y.length?(x.length>y.length?1:-1):(x>y?1:-1);
    }return 0;
  }
  function newer(value){return Number.isSafeInteger(value.versionCode)&&value.versionCode>0?Math.sign(value.versionCode-current.versionCode):compareNames(value.versionName,current.versionName);}
  function safeResult(value){
    if(!value||value.available!==true||value.packageName!==config.packageName||value.appKey!==config.appKey||typeof value.versionName!=='string'||value.versionName.length>40||!/^\d+(?:\.\d+)*$/.test(value.versionName))return null;
    return {available:true,packageName:config.packageName,appKey:config.appKey,versionName:value.versionName,versionCode:Number.isSafeInteger(value.versionCode)?value.versionCode:null,notes:typeof value.notes==='string'?value.notes.slice(0,4000):'',source:value.source==='pgyer-api'?'pgyer-api':'public-page'};
  }
  const busy=()=>['restoring','preparing','downloading','verifying','installing'].includes(download.state);
  const bytes=value=>value>=1048576?(value/1048576).toFixed(1)+' MB':Math.max(0,Math.round(value/1024))+' KB';
  const percent=()=>download.total>0?Math.min(100,Math.floor(download.downloaded/download.total*100)):null;
  function display(message){
    const diff=result?newer(result):null,hasUpdate=diff===1,active=inApp&&download.state!=='idle';
    $('homeVersion').textContent='v'+current.versionName+' · 更新';
    $('homeVersion').setAttribute('aria-label','当前版本 '+current.versionName+'，查看版本与更新');
    $('updateCurrentVersion').textContent=(native?'安装版本':'页面版本')+' v'+current.versionName;
    const status=message||(result?(hasUpdate?'发现新版本 v'+result.versionName:diff===0?'公开版本与当前相同（v'+result.versionName+'）':diff===-1?'公开版本 v'+result.versionName+'，当前 v'+current.versionName+' 更新。':'公开版本 v'+result.versionName+'，请核对版本。'):'点“检查更新”，查看是否有新版本。');
    $('updateStatus').textContent=status;
    const progress=percent();
    const short={restoring:'检查安装包…',preparing:'准备下载…',downloading:progress===null?'正在下载…':'下载 '+progress+'%',verifying:'检查安装包…',ready:'安装包已就绪',permission:'等待允许安装',installing:'等待系统安装',error:'更新未完成',cancelled:'下载已取消'};
    $('homeUpdateStatus').textContent=active?short[download.state]:message||(hasUpdate?'发现 v'+result.versionName:result?'公开 v'+result.versionName:'');
    $('homeInstallUpdate').hidden=!hasUpdate&&!active;$('homeCheckUpdate').hidden=hasUpdate||active;
    $('homeInstallUpdate').textContent=inApp?(busy()?'查看进度':['ready','permission'].includes(download.state)?'继续更新':'查看更新'):'去更新';
    $('updateInstallLink').hidden=inApp;
    if(inApp)$('updateInstallLink').removeAttribute('href');
    else{$('updateInstallLink').textContent=hasUpdate?'前往更新':'打开安装页';$('updateInstallLink').href=config.installUrl;}
    $('updateNotesTitle').textContent=hasUpdate&&result.notes?'v'+result.versionName+' 更新内容':'v'+config.versionName+' 本次更新';
    $('updateNotes').textContent=hasUpdate&&result.notes?result.notes:config.notes;
    $('updateHint').textContent=inApp?'在 App 内下载，完成后由手机系统确认安装。首次使用需要允许安装应用；关闭此窗口可继续学习。':native?'更新会打开蒲公英公开安装页，下载后按手机提示安装。':'可在蒲公英公开安装页下载安卓安装包；网页内容更新后刷新即可。';
    for(const id of ['homeCheckUpdate','dialogCheckUpdate']){$(id).disabled=!!pending||(inApp&&(busy()||commandPending));$(id).textContent=pending?'检查中…':'检查更新';}
    $('updateDownloadPanel').hidden=!active;$('updateDownloadPanel').dataset.state=download.state;
    $('updateDownloadMessage').textContent=download.message;
    $('updateProgressRow').hidden=!active||['error','cancelled'].includes(download.state);
    if(progress===null||['restoring','preparing'].includes(download.state))$('updateProgress').removeAttribute('value');
    else $('updateProgress').value=progress;
    $('updateProgressText').textContent=download.downloaded>0?(progress===null?bytes(download.downloaded)+' 已下载':progress+'% · '+bytes(download.downloaded)+' / '+bytes(download.total)):'请稍候…';
    $('cancelUpdateDownload').hidden=!inApp||!['preparing','downloading','verifying'].includes(download.state);
    $('cancelUpdateDownload').disabled=commandPending;
    const action=$('nativeUpdateAction');action.hidden=!inApp||(!hasUpdate&&!active);action.disabled=busy()||commandPending;
    action.textContent=({restoring:'检查中…',preparing:'准备中…',downloading:'下载中…',verifying:'检查中…',ready:'继续安装',permission:'允许安装',installing:'等待安装…',error:'重试下载',cancelled:'重新下载'})[download.state]||'下载并安装';
  }
  function acceptDownload(value){
    if(!inApp||!value||!stages.has(value.state))return false;
    download={state:value.state,message:typeof value.message==='string'?value.message.slice(0,300):'',downloaded:Number.isSafeInteger(value.downloaded)&&value.downloaded>=0?value.downloaded:0,total:Number.isSafeInteger(value.total)&&value.total>0?value.total:-1,versionName:typeof value.versionName==='string'&&/^\d+(?:\.\d+)*$/.test(value.versionName)?value.versionName.slice(0,40):''};
    commandPending=false;clearTimeout(commandTimer);display();return true;
  }
  function syncDownload(){if(inApp)try{acceptDownload(JSON.parse(native.downloadState()));}catch(_){} }
  function command(method){
    if(!inApp||commandPending)return;
    commandPending=true;
    if(method!=='cancelDownload')download={...download,state:method==='downloadUpdate'?'preparing':'verifying',message:method==='downloadUpdate'?'正在准备下载…':'正在检查安装包…'};
    display();
    try{native[method]();commandTimer=setTimeout(()=>{syncDownload();if(commandPending){commandPending=false;display();}},2000);}
    catch(_){commandPending=false;download={...download,state:'error',message:'更新暂时不可用，请重新打开应用后重试。'};display();}
  }
  function storeResult(){try{localStorage.setItem(cacheKey,JSON.stringify({result,lastChecked}));}catch(_){} }
  function finish(value,id){
    if(!pending||id!==pending.id)return;clearTimeout(pending.timer);pending=null;
    const accepted=safeResult(value);
    if(accepted){result=accepted;lastChecked=Date.now();storeResult();display();}
    else display(inApp?'暂时无法检查，请检查网络后重试。':'暂时无法检查，可重试或打开安装页。');
  }
  async function check(){
    if(pending||(inApp&&(busy()||commandPending)))return;
    const id='update-'+(++serial);pending={id,timer:setTimeout(()=>finish(null,id),15000)};display('正在检查更新…');
    if(native&&typeof native.check==='function'){try{native.check(id);}catch(_){finish(null,id);}return;}
    if(!/^https?:$/.test(location.protocol)){finish(null,id);return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12500);
    try{const response=await fetch('/api/app/update',{signal:controller.signal,cache:'no-store',credentials:'same-origin'});finish(response.ok?await response.json():null,id);}catch(_){finish(null,id);}finally{clearTimeout(timer);}
  }
  function open(){syncDownload();if(!dialog.open)dialog.showModal();display(pending?'正在检查更新…':undefined);}
  function install(event){
    if(inApp){event.preventDefault();return;}
    if(native&&typeof native.openInstallPage==='function'){event.preventDefault();try{native.openInstallPage();}catch(_){display('暂时无法打开安装页，请稍后再试。');}}
  }
  $('homeVersion').addEventListener('click',open);
  $('homeCheckUpdate').addEventListener('click',()=>{open();check();});$('dialogCheckUpdate').addEventListener('click',check);
  $('homeInstallUpdate').addEventListener('click',open);$('updateInstallLink').addEventListener('click',install);
  $('nativeUpdateAction').addEventListener('click',()=>{if(!busy())command(['ready','permission'].includes(download.state)?'installUpdate':'downloadUpdate');});
  $('cancelUpdateDownload').addEventListener('click',()=>command('cancelDownload'));
  $('closeUpdateDialog').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(document.body.dataset.mode==='home')$('homeVersion').focus({preventScroll:true});});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});
  window.addEventListener('appupdate',event=>{const detail=event.detail||{};finish(detail.result,detail.id);});
  window.addEventListener('appupdatedownload',event=>acceptDownload(event.detail));
  window.addEventListener('appupdateresume',syncDownload);window.addEventListener('pageshow',syncDownload);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncDownload();});
  window.addEventListener('appupdateopenerror',()=>{if(!inApp)display('没有可用的浏览器，请在手机浏览器打开蒲公英安装页。');});
  window.addEventListener('learningmodechange',event=>{if(event.detail.mode!=='home'&&dialog.open)dialog.close();});
  try{const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(cached&&Date.now()-cached.lastChecked<300000&&Date.now()>=cached.lastChecked){result=safeResult(cached.result);lastChecked=cached.lastChecked;}}catch(_){}
  syncDownload();display();
  // Update requests run after the home page paints; games and speech never wait for the network.
  setTimeout(()=>{if(document.body.dataset.mode==='home'&&!document.hidden&&Date.now()-lastChecked>300000&&(native||/^https?:$/.test(location.protocol)))check();},1600);
  window.AppUpdateUI=Object.freeze({open,back:()=>{if(!dialog.open)return false;dialog.close();return true;}});
})();
