'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require('playwright'),{releaseInfo}=require('../scripts/build-updates.cjs');
const root=path.resolve(__dirname,'..'),out=require('./check-output.cjs').directory('in-app-update-1.17'),config=releaseInfo();
const parts=config.versionName.split('.').map(Number);parts[parts.length-1]++;
const next={versionName:parts.join('.'),versionCode:config.versionCode+1};
const report={completed:false,simulatedNativeBridge:true,scenarios:[],viewports:[],pageErrors:[],externalRequests:[]};
const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
async function installBridge(context){
  await context.addInitScript(({config,next})=>{
    window.__calls={download:0,cancel:0,install:0,browser:0};
    window.__download=JSON.parse(sessionStorage.getItem('update-fixture')||'null')||{state:'idle',message:'',downloaded:0,total:-1,versionName:''};
    window.__setDownload=value=>{window.__download={...window.__download,...value};sessionStorage.setItem('update-fixture',JSON.stringify(window.__download));window.dispatchEvent(new CustomEvent('appupdatedownload',{detail:window.__download}));};
    window.AppUpdates={
      currentVersion:()=>JSON.stringify({packageName:config.packageName,versionName:config.versionName,versionCode:config.versionCode}),
      check:id=>setTimeout(()=>window.dispatchEvent(new CustomEvent('appupdate',{detail:{id,result:{available:true,packageName:config.packageName,appKey:config.appKey,...next,notes:'应用内更新测试',source:'public-page'}}})),15),
      downloadState:()=>JSON.stringify(window.__download),
      downloadUpdate(){window.__calls.download++;window.__download={state:'preparing',message:'正在准备下载…',downloaded:0,total:-1,versionName:next.versionName};setTimeout(()=>window.__setDownload(window.__download),50);},
      cancelDownload(){window.__calls.cancel++;setTimeout(()=>window.__setDownload({state:'cancelled',message:'下载已取消，可重新下载。'}),30);},
      installUpdate(){window.__calls.install++;window.__setDownload({state:'verifying',message:'正在检查安装包…'});},
      openInstallPage(){window.__calls.browser++;}
    };
    window.open=()=>{window.__calls.browser++;return null;};
  },{config,next});
}
const waitStage=(page,state)=>page.waitForFunction(state=>document.getElementById('updateDownloadPanel').dataset.state===state,state);
async function setStage(page,value){await page.evaluate(value=>window.__setDownload(value),value);await waitStage(page,value.state);}
async function checkBounds(page){
  const box=await page.locator('#updateDialog').boundingBox(),size=page.viewportSize();
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,'dialog fits viewport');
  assert.equal(await page.locator('#updateDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'no horizontal overflow');
  const action=page.locator('#nativeUpdateAction');if(await action.isVisible()){await action.scrollIntoViewIfNeeded();const a=await action.boundingBox();assert.ok(a.y>=0&&a.y+a.height<=size.height+1,'action can be reached');}
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');}else {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:320,height:568}});await installBridge(context);
    await context.route('**/*',route=>{if(!route.request().url().startsWith(url)){report.externalRequests.push(new URL(route.request().url()).origin);return route.abort();}return route.continue();});
    const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
    await page.goto(url+'/#home');await page.locator('#homeCheckUpdate').click();await page.waitForFunction(()=>document.getElementById('updateStatus').textContent.includes('发现新版本'));
    assert.equal(await page.locator('#updateInstallLink').isHidden(),true);assert.equal(await page.locator('#updateInstallLink').getAttribute('href'),null);
    assert.equal(await page.locator('#nativeUpdateAction').textContent(),'下载并安装');
    await page.evaluate(()=>{document.getElementById('nativeUpdateAction').click();document.getElementById('nativeUpdateAction').click();});
    assert.equal(await page.evaluate(()=>window.__calls.download),1);await page.waitForFunction(()=>!document.getElementById('cancelUpdateDownload').disabled);
    await setStage(page,{state:'downloading',message:'正在下载安装包…',downloaded:1048576,total:2097152});
    assert.equal(await page.locator('#updateProgress').getAttribute('value'),'50');assert.ok((await page.locator('#updateProgressText').textContent()).includes('50%'));
    await checkBounds(page);await page.screenshot({path:path.join(out,'320-download.png')});
    report.scenarios.push('In-App download action, immediate duplicate-click prevention, percent and byte progress');
    await page.locator('#closeUpdateDialog').click();await page.locator('[data-open-mode="poetry"]').click();
    await setStage(page,{state:'downloading',message:'正在下载安装包…',downloaded:1572864,total:2097152});
    assert.equal(await page.locator('#updateDialog').isVisible(),false);assert.equal(await page.locator('#poetryCatalog').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.__calls.cancel),0);
    await page.evaluate(()=>location.hash='home');await page.locator('#homeInstallUpdate').click();assert.ok((await page.locator('#updateProgressText').textContent()).includes('75%'));
    await page.locator('#cancelUpdateDownload').click();await waitStage(page,'cancelled');assert.equal(await page.evaluate(()=>window.__calls.cancel),1);
    await page.locator('#nativeUpdateAction').click();await page.waitForFunction(()=>!document.getElementById('cancelUpdateDownload').disabled);assert.equal(await page.evaluate(()=>window.__calls.download),2);
    await setStage(page,{state:'error',message:'下载未完成，请检查网络和手机可用空间后重试。'});assert.equal(await page.locator('#nativeUpdateAction').textContent(),'重试下载');assert.equal(await page.locator('#nativeUpdateAction').isEnabled(),true);
    await page.locator('#nativeUpdateAction').click();await page.waitForFunction(()=>!document.getElementById('cancelUpdateDownload').disabled);assert.equal(await page.evaluate(()=>window.__calls.download),3);
    await setStage(page,{state:'downloading',message:'正在下载安装包…',downloaded:1024,total:-1});assert.equal(await page.locator('#updateProgress').getAttribute('value'),null);assert.ok((await page.locator('#updateProgressText').textContent()).includes('已下载'));
    report.scenarios.push('Closing dialog and entering lessons preserves download; cancel, retry and unknown size work');
    await setStage(page,{state:'verifying',message:'下载完成，正在检查安装包…',downloaded:2097152,total:2097152});assert.equal(await page.locator('#nativeUpdateAction').isDisabled(),true);
    await setStage(page,{state:'permission',message:'尚未允许安装，点“允许安装”后可继续。'});assert.equal(await page.locator('#nativeUpdateAction').textContent(),'允许安装');
    await page.locator('#nativeUpdateAction').click();assert.equal(await page.evaluate(()=>window.__calls.install),1);
    await setStage(page,{state:'installing',message:'请在系统安装窗口中确认更新。'});assert.equal(await page.locator('#nativeUpdateAction').isDisabled(),true);
    await setStage(page,{state:'ready',message:'安装尚未完成，可继续安装。'});await page.locator('#nativeUpdateAction').click();assert.equal(await page.evaluate(()=>window.__calls.install),2);
    await setStage(page,{state:'ready',message:'已下载新版，可继续安装。'});await page.reload();await page.locator('#homeVersion').click();assert.equal(await page.locator('#nativeUpdateAction').textContent(),'继续安装');assert.equal(await page.evaluate(()=>window.__calls.download),0);
    report.scenarios.push('Verification, install permission, installer return and downloaded-state restoration across reload');
    await page.evaluate(()=>{window.__download={...window.__download,state:'downloading',message:'后台下载仍在继续',downloaded:1536,total:2048};window.dispatchEvent(new Event('appupdateresume'));});await waitStage(page,'downloading');
    assert.ok((await page.locator('#updateProgressText').textContent()).includes('75%'));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('appupdatedownload',{detail:{state:'injected',message:'invalid'}})));await waitStage(page,'downloading');
    await setStage(page,{state:'error',message:'<img src=x onerror=alert(1)>'});assert.equal(await page.locator('#updateDownloadMessage img').count(),0);
    assert.equal(await page.evaluate(()=>window.__calls.browser),0);assert.equal(context.pages().length,1);
    report.scenarios.push('Resume snapshot, unknown-state rejection, safe text rendering, no browser or popup');
    for(const [width,height] of [[320,568],[360,640],[390,844],[412,915],[568,320],[760,900]]){
      await page.setViewportSize({width,height});await setStage(page,{state:'downloading',message:'正在下载安装包…',downloaded:1048576,total:2097152});
      await checkBounds(page);await page.screenshot({path:path.join(out,width+'x'+height+'-download.png')});
      assert.equal(await page.evaluate(()=>window.AppUpdateUI.back()),true);assert.equal(await page.locator('[data-open-mode]').count(),9);
      const overflow=await page.locator('#homeScreen button').evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length).map(el=>({id:el.id,b:el.getBoundingClientRect().toJSON()})).filter(({b})=>b.x<0||b.right>innerWidth+1||b.y<0||b.bottom>innerHeight+1));
      assert.deepEqual(overflow,[],'all home controls fit');await page.screenshot({path:path.join(out,width+'x'+height+'-home.png')});
      await page.locator('#homeInstallUpdate').click();report.viewports.push({width,height});
    }
    await context.close();assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.externalRequests,[]);report.completed=true;
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'ui.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
