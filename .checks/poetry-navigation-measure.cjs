'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const out=path.join(__dirname,'poetry-navigation');fs.mkdirSync(out,{recursive:true});
const tag=process.argv[2]||'after',base=process.env.POETRY_PREVIEW_URL||'http://127.0.0.1:8765/';
function request(encoding){return new Promise((resolve,reject)=>{const start=performance.now();http.get(base,{headers:encoding?{'Accept-Encoding':encoding}:{}},res=>{let bytes=0;res.on('data',b=>bytes+=b.length);res.on('end',()=>resolve({status:res.statusCode,encoding:res.headers['content-encoding']||'identity',bytes,ms:Math.round(performance.now()-start),etag:res.headers.etag||null,cacheControl:res.headers['cache-control']}));}).on('error',reject);});}
async function swipe(page){
  const cdp=await page.context().newCDPSession(page),v=page.viewportSize();
  const x=Math.round(v.width*.7),y=Math.round(v.height*.86);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=15;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*30}]});await page.waitForTimeout(20);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(350);await cdp.detach();
}
(async()=>{
  const report={tag,environment:'Chrome mobile emulation, 390x844; throttled run: 2 Mbps download, 40 ms latency, CPU x4',http:{identity:await request(),gzip:await request('gzip')}};
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const page=await context.newPage();await page.goto(base+'#poetry');
    report.catalog=await page.evaluate(()=>({cards:document.querySelectorAll('[data-poetry-id]').length,domElements:document.querySelectorAll('*').length,rootOverflow:getComputedStyle(document.documentElement).overflowY,bodyOverflow:getComputedStyle(document.body).overflowY,screenOverflow:getComputedStyle(document.querySelector('#poetryScreen')).overflowY,height:document.documentElement.scrollHeight,scroll:scrollY}));
    await swipe(page);report.catalog.touchScrollAfter=await page.evaluate(()=>scrollY);
    await page.screenshot({path:path.join(out,tag+'-touch.png')});
    await context.close();
    const slow=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const slowPage=await slow.newPage(),cdp=await slow.newCDPSession(slowPage);
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:250000,uploadThroughput:125000});
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await slowPage.goto(base+'#poetry');
    report.throttledNavigation=await slowPage.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {transferSize:n.transferSize,encodedBodySize:n.encodedBodySize,decodedBodySize:n.decodedBodySize,domContentLoadedMs:Math.round(n.domContentLoadedEventEnd),loadMs:Math.round(n.loadEventEnd)};});
    await slow.close();
  }finally{await browser.close();}
  fs.writeFileSync(path.join(out,tag+'-measurement.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
