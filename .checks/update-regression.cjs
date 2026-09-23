'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require('playwright');
const {createUpdateService,publicVersion}=require('../server/update-service.cjs');
const {releaseInfo}=require('../scripts/build-updates.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'pgyer-update');fs.mkdirSync(out,{recursive:true});
const config=releaseInfo(),key='unit-test-only-private-key',report={completed:false,server:[],ui:[],errors:[]};
const versionParts=config.versionName.split('.').map(Number),nearby=delta=>versionParts.map((part,i)=>i===versionParts.length-1?Math.max(0,part+delta):part).join('.');
const next={versionName:nearby(1),versionCode:config.versionCode+1},previous={versionName:nearby(-1),versionCode:config.versionCode-1};
const api=(extra={})=>({code:0,data:{appKey:config.appKey,buildIdentifier:config.packageName,buildVersion:next.versionName,buildVersionNo:String(next.versionCode),buildUpdateDescription:'新版本说明 '+key,downloadURL:'https://www.pgyer.com/apiv2/app/install?_api_key='+key,...extra}});
const available=(extra={})=>({available:true,appKey:config.appKey,packageName:config.packageName,...next,notes:'诗词阅读和版本更新',source:'pgyer-api',...extra});
async function backend(){
  let calls=0,now=1000;
  const service=createUpdateService(root,{now:()=>now,loadApiKey:async()=>key,fetch:async(url,options)=>{calls++;assert.equal(url,'https://www.pgyer.com/apiv2/app/check');assert.equal(options.body.get('_api_key'),key);assert.equal(options.body.get('appKey'),config.appKey);return new Response(JSON.stringify(api()));}});
  const results=await Promise.all(Array.from({length:8},()=>service()));assert.equal(calls,1);
  for(const result of results){assert.equal(result.versionCode,next.versionCode);assert.equal(result.installUrl,config.installUrl);assert.equal(JSON.stringify(result).includes(key),false);assert.equal('downloadURL' in result,false);}
  now+=60001;await service();assert.equal(calls,2);report.server.push('Official API request, safe field whitelist, secret redaction, deduplication and cache expiry');
  for(const payload of [api({appKey:'other'}),api({buildIdentifier:'other.package'}),api({buildVersionNo:'-1'}),{code:999,message:key},api({buildVersion:'<script>'})]){
    const invalid=createUpdateService(root,{loadApiKey:async()=>key,fetch:async()=>new Response(JSON.stringify(payload))});const result=await invalid();assert.equal(result.available,false);assert.equal(JSON.stringify(result).includes(key),false);
  }
  const offline=createUpdateService(root,{loadApiKey:async()=>key,fetch:async()=>{throw Error(key);}});assert.equal((await offline()).available,false);
  const oversized=createUpdateService(root,{loadApiKey:async()=>key,fetch:async()=>new Response('x'.repeat(262145))});assert.equal((await oversized()).available,false);
  const saved=fs.readFileSync(path.join(out,'public-page.html'),'utf8');assert.equal(publicVersion(saved,config).versionName,'1.7');
  const fallback=createUpdateService(root,{loadApiKey:async()=>'',fetch:async(url)=>{assert.equal(url,config.installUrl);return new Response(saved);}});assert.equal((await fallback()).source,'public-page');
  assert.throws(()=>publicVersion(saved,{...config,appKey:'other'}));report.server.push('Wrong app, invalid version, upstream failures, oversized responses and real public-page parsing');
}
async function frontend(){
  let response=available(),status=200,requests=0;
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
  const server=http.createServer((req,res)=>{if(req.url==='/api/app/update'){requests++;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(response));}else if(req.url==='/api/speech/status'){res.end(JSON.stringify({available:false}));}else {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:320,height:568}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(url+'/#home');await page.locator('#homeCheckUpdate').click();await page.waitForFunction(()=>document.getElementById('updateStatus').textContent.includes('发现新版本'));
    assert.equal(await page.locator('#updateInstallLink').getAttribute('href'),config.installUrl);assert.equal(await page.locator('#homeInstallUpdate').isVisible(),true);
    await page.screenshot({path:path.join(out,'320-update-available.png')});await page.locator('#closeUpdateDialog').click();
    assert.equal(await page.locator('#homeVersion').evaluate(el=>document.activeElement===el||document.activeElement.id==='homeCheckUpdate'),true);
    await page.screenshot({path:path.join(out,'320-home.png')});
    const bounds=await page.locator('#homeScreen button').evaluateAll(elements=>elements.map(e=>({id:e.id,hidden:!e.getClientRects().length,b:e.getBoundingClientRect().toJSON()})).filter(e=>!e.hidden&&(e.b.bottom>innerHeight+1||e.b.top<0||e.b.right>innerWidth+1)));
    assert.deepEqual(bounds,[]);assert.equal(await page.locator('[data-open-mode]').count(),9);
    await page.locator('#homeVersion').click();response=available(previous);await page.locator('#dialogCheckUpdate').click();await page.waitForFunction(version=>document.getElementById('updateStatus').textContent.includes('当前 v'+version+' 更新'),config.versionName);
    assert.equal(await page.locator('#homeInstallUpdate').isHidden(),true);
    response=available({versionName:config.versionName,versionCode:config.versionCode});await page.locator('#dialogCheckUpdate').click();await page.waitForFunction(()=>document.getElementById('updateStatus').textContent.includes('相同'));
    response={available:false};status=503;await page.locator('#dialogCheckUpdate').click();await page.waitForFunction(()=>document.getElementById('updateStatus').textContent.includes('暂时无法检查'));assert.equal(await page.locator('#dialogCheckUpdate').isEnabled(),true);
    status=200;response=available({versionName:'1.100',versionCode:null,source:'public-page',notes:'<img src=x onerror=alert(1)>'});await page.locator('#dialogCheckUpdate').click();await page.waitForFunction(()=>document.getElementById('updateStatus').textContent.includes('1.100'));assert.equal(await page.locator('#updateNotes img').count(),0);assert.ok((await page.locator('#updateNotes').textContent()).includes('<img'));
    await page.locator('#closeUpdateDialog').click();await page.locator('[data-open-mode="poetry"]').click();assert.equal(await page.locator('#poetryCatalog').isVisible(),true);
    report.ui.push('All eight entries remain visible; current/newer/older versions, numeric comparison, error retry, safe notes and clean installation URL');await context.close();
    const native=await browser.newContext({viewport:{width:390,height:844}});
    await native.addInitScript(({config,previous})=>{window.__opened=0;window.__checks=[];window.AppUpdates={currentVersion(){return JSON.stringify({packageName:config.packageName,...previous});},check(id){window.__checks.push(id);setTimeout(()=>window.dispatchEvent(new CustomEvent('appupdate',{detail:{id,result:{available:true,appKey:config.appKey,packageName:config.packageName,versionName:config.versionName,versionCode:null,source:'public-page'}}})),20);},openInstallPage(){window.__opened++;}};},{config,previous});
    const n=await native.newPage();n.on('pageerror',e=>report.errors.push(e.message));await n.goto(url+'/#home');await n.locator('#homeCheckUpdate').click();await n.waitForFunction(()=>document.getElementById('updateStatus').textContent.includes('发现新版本'));assert.ok((await n.locator('#updateCurrentVersion').textContent()).includes(previous.versionName));
    await n.locator('#updateInstallLink').click();assert.equal(await n.evaluate(()=>window.__opened),1);assert.equal(await n.evaluate(()=>window.AppUpdateUI.back()),true);assert.equal(await n.locator('#updateDialog').isVisible(),false);
    await native.close();report.ui.push('Simulated native bridge uses installed version, asynchronous public metadata, external installer page and Android back');
    const fail=await browser.newContext();await fail.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('denied');}});});const f=await fail.newPage();f.on('pageerror',e=>report.errors.push(e.message));await f.goto(url+'/#home');await f.locator('[data-open-mode="poetry"]').click();assert.ok(await f.locator('#poetryCatalog').isVisible());await fail.close();
    assert.deepEqual(report.errors,[]);report.requests=requests;
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
(async()=>{try{await backend();await frontend();report.completed=true;console.log(JSON.stringify(report));}finally{fs.writeFileSync(path.join(out,'regression.json'),JSON.stringify(report,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
