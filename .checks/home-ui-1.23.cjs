'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'home-ui-1.23');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
  const report={completed:false,errors:[],screens:[],navigation:[]};
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    for(const [width,height] of [[320,568],[360,640],[390,844],[412,915],[760,900],[820,1180],[900,900],[1280,900],[1920,1080],[568,320],[667,375],[844,390],[960,540]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<761}),page=await context.newPage();
      page.on('pageerror',e=>report.errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/#home');await page.evaluate(()=>document.fonts.ready);
      const screen=await page.evaluate(()=>{
        const box=el=>el.getBoundingClientRect().toJSON();
        const cards=[...document.querySelectorAll('[data-open-mode]')].map(el=>{
          const title=el.querySelector('h2'),cover=el.querySelector('.mode-cover'),content=el.querySelector('.mode-content');
          return {mode:el.dataset.openMode,title:title.textContent,rect:box(el),cover:box(cover),titleRect:box(title),font:getComputedStyle(title).fontSize,padding:getComputedStyle(content).padding,flow:getComputedStyle(el).flexDirection};
        });
        const controls=[...document.querySelectorAll('.header button,.home-update-bar button')].filter(el=>el.getClientRects().length).map(el=>({id:el.id,rect:box(el)}));
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,cards,controls};
      });
      report.screens.push(screen);await page.screenshot({path:path.join(out,`${width}x${height}-home.png`)});
      if(width===390){
        for(const mode of ['attention','tangram']){
          await page.locator('[data-open-mode="'+mode+'"]').click();
          await page.waitForFunction(mode=>document.body.dataset.mode===mode,mode);
          report.navigation.push({mode,title:await page.title(),heading:await page.locator(mode==='attention'?'#attentionTitle':'#tangramTitle').textContent().catch(()=>null)});
          await page.screenshot({path:path.join(out,mode+'.png')});
          await page.locator('#backHome').click();await page.waitForFunction(()=>document.body.dataset.mode==='home');
        }
      }
      await context.close();
    }
    report.completed=true;
  }finally{
    await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'layout.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({completed:report.completed,errors:report.errors,navigation:report.navigation,screens:report.screens.map(s=>({width:s.width,height:s.height,count:s.cards.length,minCardHeight:Math.min(...s.cards.map(c=>c.rect.height)),minCoverHeight:Math.min(...s.cards.map(c=>c.cover.height)),pairSameRow:Math.abs(s.cards[8].rect.y-s.cards[9].rect.y)<1,overflow:s.cards.filter(c=>c.rect.right>s.width+1||c.rect.bottom>s.height+1||c.titleRect.bottom>c.rect.bottom+1||c.titleRect.right>c.rect.right+1).map(c=>c.mode)}))}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
