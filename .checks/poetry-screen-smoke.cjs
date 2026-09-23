'use strict';
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'poetry-screen');fs.mkdirSync(out,{recursive:true});
const file=pathToFileURL(path.join(root,'app/src/main/assets/index.html')).href;
const report={screens:[],errors:[]};
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    for(const [width,height] of [[320,568],[360,640],[390,844],[412,915],[760,900],[1280,900],[568,320],[390,300]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true}),page=await context.newPage();
      page.on('pageerror',e=>report.errors.push({width,height,error:e.message}));
      for(const mode of ['catalog','read','explain','title','directory']){
        await page.goto(file+(mode==='catalog'||mode==='directory'?'#poetry':'#poetry/ts-250'));await frame(page);
        if(mode==='explain')await page.locator('#poetryExplainTab').click();
        if(mode==='title')await page.locator('#poetryFullTitle').click();
        if(mode==='directory')await page.locator('#poetryOpenDirectory').click();
        await frame(page);
        const metrics=await page.evaluate(()=>{
          const ids=['poetryScreen','poetryCatalog','poetryList','poetryPagerBottom','poetryReader','poetryReaderPage','poetryVerses','poetryExplanation','poetrySheetContent'];
          const boxes=Object.fromEntries(ids.map(id=>{const e=document.getElementById(id),b=e.getBoundingClientRect();return [id,{visible:!!e.getClientRects().length,top:b.top,bottom:b.bottom,height:b.height,width:b.width,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth}]}));
          return {root:{height:innerHeight,scrollHeight:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth},cards:document.querySelectorAll('[data-poetry-id]').length,pages:document.getElementById('poetryReaderPage').options.length,boxes};
        });
        report.screens.push({width,height,mode,...metrics});
        await page.screenshot({path:path.join(out,`${width}x${height}-${mode}.png`)});
      }
      await context.close();
    }
  }finally{await browser.close();fs.writeFileSync(path.join(out,'smoke.json'),JSON.stringify(report,null,2));}
  const issues=report.screens.flatMap(s=>Object.entries(s.boxes).filter(([id,b])=>b.visible&&(b.top<-.5||b.bottom>s.height+.5||b.scrollHeight>b.clientHeight+1||b.scrollWidth>b.clientWidth+1)).map(([id,b])=>({viewport:[s.width,s.height],mode:s.mode,id,...b})));
  console.log(JSON.stringify({screens:report.screens.length,errors:report.errors,issues},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
