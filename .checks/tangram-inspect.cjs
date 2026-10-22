const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'tangram');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(fs.readFileSync(path.join(root,'app/src/main/assets/index.html')));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const page=await browser.newPage();page.on('pageerror',e=>console.log('ERROR',e.message));
    for(const [width,height] of [[390,844],[360,640],[320,568],[844,390]]){
      await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:'+server.address().port+'/#tangram');await page.reload();
      await page.screenshot({path:path.join(out,`${width}-${height}-menu.png`)});
      await page.locator('[data-tg-level]').first().click();
      await page.screenshot({path:path.join(out,`${width}-${height}-play.png`)});
      console.log(JSON.stringify(await page.evaluate(()=>({width:innerWidth,height:innerHeight,board:document.getElementById('tgBoard').getBoundingClientRect().toJSON(),screen:document.getElementById('tgPlay').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollHeight-innerHeight}))));
    }
    const g=require('../modules/tangram/geometry.js'),data=require('../content/tangram/levels.json');
    await page.setViewportSize({width:1200,height:900});
    await page.setContent('<meta charset="UTF-8"><style>body{margin:0;background:#fffdf5;font-family:Microsoft YaHei;display:grid;grid-template-columns:repeat(6,1fr)}section{text-align:center;border:1px solid #ccc;height:220px}svg{width:180px;height:155px}p{margin:10px}</style>'+data.levels.map(l=>{const f=g.fit(l.polygons);return '<section><p>'+l.id+' '+l.name+'</p><svg viewBox="0 0 600 345">'+f.target.map((p,i)=>'<polygon points="'+p.map(v=>v.join(',')).join(' ')+'" fill="'+g.colors[i]+'" stroke="white" stroke-width="2"/>').join('')+'</svg></section>';}).join(''));
    await page.screenshot({path:path.join(out,'levels.png'),fullPage:true});
  }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
