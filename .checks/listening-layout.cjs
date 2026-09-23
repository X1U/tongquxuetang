'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=require('./check-output.cjs').directory('listening-1.14');fs.mkdirSync(out,{recursive:true});
const report={completed:false,errors:[],screens:[]};
(async()=>{
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    for(const [width,height] of [[320,568],[360,640],[390,844],[412,915],[760,900],[1280,900],[568,320],[844,390]]){
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:width<761,hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/#home');
      assert.equal(await page.locator('[data-open-mode]').count(),9);
      for(const mode of ['home','sound','sequence','train','repeat']){
        if(mode==='sequence')await page.locator('[data-sound-mode="sequence"]').click();
        else if(mode==='repeat')await page.locator('[data-train-mode="repeat"]').click();
        else await page.evaluate(mode=>location.hash=mode,mode);
        await page.waitForTimeout(70);
        const selector=['sound','sequence'].includes(mode)?'#soundScreen':['train','repeat'].includes(mode)?'#trainScreen':'#homeScreen';
        const bounds=await page.locator(selector).evaluate(el=>{
          const r=el.getBoundingClientRect(),root=document.documentElement;
          return {width:innerWidth,height:innerHeight,rootWidth:root.scrollWidth,rootHeight:root.scrollHeight,screen:r.toJSON(),outside:[...el.querySelectorAll('button,select,input')].filter(e=>e.getClientRects().length).map(e=>({id:e.id||e.textContent,rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.rect.bottom>innerHeight+1||e.rect.top<0||e.rect.right>innerWidth+1||e.rect.left<0),imageHeights:[...el.querySelectorAll('.sound-option img')].map(e=>e.getBoundingClientRect().height)};
        });
        report.screens.push({width,height,mode,...bounds});
        if(mode!=='home'){
          const stars=await page.locator(selector+' .listen-stars').evaluate(el=>{
            const r=el.getBoundingClientRect(),controls=el.closest('.listen-screen').querySelector('.listen-bottom').getBoundingClientRect();
            return {count:el.children.length,visible:r.width>0&&r.height>0,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,belowControls:r.top>=controls.bottom-1};
          });
          assert.equal(stars.count,5);assert.ok(stars.visible&&stars.inside&&stars.belowControls,'Five stars stay visible below the controls in '+width+'x'+height+' '+mode);
        }
        await page.screenshot({path:path.join(out,`${width}x${height}-${mode}.png`)});
      }
      await page.locator('#trainHint').click();await page.screenshot({path:path.join(out,`${width}x${height}-hint.png`)});
      const dialog=await page.locator('#listenDialog').boundingBox();assert.ok(dialog.x>=0&&dialog.y>=0&&dialog.y+dialog.height<=height+1,'Dialog stays on screen');
      await page.locator('[data-listen-action="parent-read"]').click();await page.locator('#trainReview').click();await page.screenshot({path:path.join(out,`${width}x${height}-review.png`)});
      await context.close();
    }
    assert.deepEqual(report.errors,[]);
    const overflow=report.screens.filter(s=>s.outside.length||s.rootWidth>s.width+1||s.rootHeight>s.height+1);assert.deepEqual(overflow.map(s=>({width:s.width,height:s.height,mode:s.mode,outside:s.outside,rootHeight:s.rootHeight})),[],'No page scrolling or clipped controls');
    report.completed=true;
  }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'layout.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({completed:report.completed,screens:report.screens.length,errors:report.errors}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
