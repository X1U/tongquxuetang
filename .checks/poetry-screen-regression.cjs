'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'poetry-screen');fs.mkdirSync(out,{recursive:true});
const file=pathToFileURL(path.join(root,'app/src/main/assets/index.html')).href;
const data=JSON.parse(fs.readFileSync(path.join(root,'content/poetry/poems.json'),'utf8'));
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function count(page,total){await page.waitForFunction(total=>Number(document.getElementById('poetryList').dataset.total)===total,total);}
async function search(page,text){await page.locator('#poetrySearch').fill(text);await page.locator('#poetrySearch').press('Enter');await frame(page);}
async function run(browser){
  const report={completed:false,viewports:[],content:null,behavior:[],errors:[]};
  try{
    for(const [width,height] of [[320,568],[390,844],[760,900],[1280,900],[568,320],[390,300]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
      await page.goto(file+'#poetry');await frame(page);await count(page,320);assert.equal(await page.locator('#poetryPagerTop').count(),0);
      const coverage=await page.evaluate(()=>{
        const select=document.querySelector('[data-poetry-page-select]'),ids=[];
        for(const option of [...select.options]){select.value=option.value;select.dispatchEvent(new Event('change'));ids.push(...[...document.querySelectorAll('[data-poetry-id]')].map(e=>e.dataset.poetryId));}
        return {ids,capacity:Number(document.getElementById('poetryList').dataset.pageSize),root:[innerHeight,document.documentElement.scrollHeight]};
      });
      assert.equal(coverage.ids.length,320);assert.equal(new Set(coverage.ids).size,320);assert.deepEqual(coverage.root,[height,height]);
      report.viewports.push({width,height,capacity:coverage.capacity,total:coverage.ids.length});
      await page.mouse.wheel(0,800);await frame(page);assert.equal(await page.evaluate(()=>scrollY),0);await context.close();
    }
    const context=await browser.newContext({viewport:{width:320,height:568},hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(file+'#poetry');await frame(page);
    // Reconstruct all content from the displayed pages and check each fragment's actual bounds.
    report.content=await page.evaluate(async()=>{
      const $=id=>document.getElementById(id),pause=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      let versePages=0,explanationPages=0,titlePages=0;
      function ensure(value,message){if(!value)throw new Error(message);}
      function collect(targetId){
        const target=$(targetId),box=target.getBoundingClientRect();
        return [...target.querySelectorAll('[data-poetry-fragment]')].map(element=>{
          const b=element.getBoundingClientRect();ensure(b.top>=box.top-1&&b.bottom<=box.bottom+1&&b.left>=box.left-1&&b.right<=box.right+1,'Clipped fragment: '+element.dataset.poetryFragment);
          const text=element.querySelector('[data-poetry-fragment-text]')?.textContent??[...element.querySelectorAll('ruby>span,.poetry-punctuation')].map(e=>e.textContent).join('');
          return {key:element.dataset.poetryFragment,from:Number(element.dataset.from),to:Number(element.dataset.to),text};
        });
      }
      function readPages(targetId){const all=[];for(const option of [...$('poetryReaderPage').options]){$('poetryReaderPage').value=option.value;$('poetryReaderPage').dispatchEvent(new Event('change'));all.push(...collect(targetId));}return all;}
      function verify(fragments,expected,label){for(const [key,text] of Object.entries(expected)){const parts=fragments.filter(f=>f.key===key);let offset=0;for(const f of parts){ensure(f.from===offset,label+' missing/repeated '+key);offset=f.to;}ensure(parts.map(f=>f.text).join('')===text,label+' incomplete '+key);}}
      for(const poem of window.TangPoetry.poems){
        location.hash='poetry/'+poem.id;await pause();
        const verses=readPages('poetryVerses');versePages+=$('poetryReaderPage').options.length;verify(verses,Object.fromEntries(poem.verses.map((v,i)=>['verse-'+i,v.text])),poem.title);
        $('poetryExplainTab').click();await pause();const notes=readPages('poetryExplanation');explanationPages+=$('poetryReaderPage').options.length;
        verify(notes,{meaning:poem.meaning,picture:poem.pictureCaption,...Object.fromEntries(poem.notes.map((n,i)=>['note-'+i,n.meaning]))},poem.title);
        $('poetryFullTitle').click();await pause();const titles=[];
        do{titles.push(...collect('poetrySheetContent'));titlePages++;if($('poetrySheetNext').disabled)break;$('poetrySheetNext').click();}while(titlePages<5000);
        verify(titles,{title:poem.title,...Object.fromEntries(poem.variants.map((text,i)=>['variant-'+i,text]))},poem.title);$('poetrySheetClose').click();
      }
      location.hash='poetry';await pause();$('poetryAbout').click();await pause();const about=[];
      do{about.push(...collect('poetrySheetContent'));if($('poetrySheetNext').disabled)break;$('poetrySheetNext').click();}while(about.length<200);
      verify(about,{license:window.TangPoetry.license},'License');$('poetrySheetClose').click();
      return {poems:320,versePages,explanationPages,titlePages,fullLicense:true};
    });
    await page.setViewportSize({width:390,height:844});await frame(page);
    await page.locator('#poetrySearch').dispatchEvent('compositionstart');
    await page.locator('#poetrySearch').evaluate(el=>{el.value='li';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
    await page.waitForTimeout(220);await count(page,320);assert.equal(await page.locator('#poetrySearch').inputValue(),'li');
    await page.locator('#poetrySearch').evaluate(el=>{el.value='李白';el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'李白'}));});await page.waitForTimeout(220);
    assert.ok(Number(await page.locator('#poetryList').getAttribute('data-total'))>6);await page.locator('[data-poetry-page-select]').selectOption('2');await search(page,'李白 明月');assert.equal(await page.locator('[data-poetry-page-select]').inputValue(),'1');
    await count(page,data.poems.filter(p=>{const text=[p.title,p.alternateTitle||'',p.author,...p.verses.map(v=>v.text)].join(' ');return text.includes('李白')&&text.includes('明月');}).length);
    await search(page,'床前明月光，疑是地上霜。');await count(page,1);assert.equal(await page.locator('[data-poetry-id]').getAttribute('data-poetry-id'),'ts-011');
    await search(page,'不存在的诗句987');await count(page,0);await page.locator('#poetryResetFilters').click();await count(page,320);
    for(const [category,total] of [['five/jue',29],['five/lv',80],['five/gu',35],['five/yuefu',18],['seven/jue',51],['seven/lv',53],['seven/gu',28],['seven/yuefu',16],['mixed/yuefu',10]]){
      await page.locator('#poetryOpenDirectory').click();for(let i=0;i<10&&!await page.locator('[data-poetry-directory="'+category+'"]').count();i++)await page.locator('#poetrySheetNext').click();
      await page.locator('[data-poetry-directory="'+category+'"]').click();await count(page,total);
    }
    await page.locator('[data-poetry-meter="all"]').click();await page.locator('#poetryGenre').selectOption('all');await count(page,320);await page.locator('[data-poetry-page-select]').selectOption('7');await frame(page);
    const anchor=await page.locator('[data-poetry-id]').first().getAttribute('data-poetry-id');await page.setViewportSize({width:760,height:900});await frame(page);assert.equal(await page.locator('[data-poetry-id="'+anchor+'"]').count(),1,'Resize preserves catalog anchor');
    await page.locator('[data-poetry-id="'+anchor+'"]').click();await frame(page);await page.locator('#poetryBackCatalog').click();await frame(page);assert.equal(await page.locator('[data-poetry-id="'+anchor+'"]').count(),1);
    await page.reload();await frame(page);assert.equal(await page.locator('[data-poetry-id="'+anchor+'"]').count(),1,'Reload preserves catalog page');
    await page.goto(file+'#poetry/ts-250');await frame(page);await page.locator('#poetryReaderPage').selectOption('3');const verse=await page.locator('#poetryVerses [data-poetry-fragment]').first().getAttribute('data-poetry-fragment');
    await page.setViewportSize({width:320,height:568});await frame(page);assert.equal(await page.locator('#poetryVerses [data-poetry-fragment="'+verse+'"]').count(),1,'Resize preserves current verse');
    await page.reload();await frame(page);assert.equal(await page.locator('#poetryVerses [data-poetry-fragment="'+verse+'"]').count(),1);
    await page.locator('#poetryPinyin').uncheck();await frame(page);assert.equal(await page.locator('#poetryVerses rt:visible').count(),0);
    await page.locator('#poetryExplainTab').click();assert.equal(await page.evaluate(()=>window.TangPoetryUI.back()),true);assert.ok(await page.locator('#poetryReadPanel').isVisible());
    await page.locator('#poetryFullTitle').click();assert.equal(await page.evaluate(()=>window.TangPoetryUI.back()),true);assert.ok(await page.locator('#poetrySheet').isHidden());
    await context.close();report.behavior.push('IME, multi-keyword/full-text search, all nine categories, catalog/reader resize and reload, pinyin and Android back');
    const blocked=await browser.newContext();await blocked.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('unavailable');}});});const b=await blocked.newPage();b.on('pageerror',e=>report.errors.push(e.message));await b.goto(file+'#poetry/ts-011');await frame(b);await b.locator('#poetryPinyin').uncheck();await b.locator('#poetryBackCatalog').click();await count(b,320);await blocked.close();
    report.behavior.push('Storage-denied mode');assert.deepEqual(report.errors,[]);report.completed=true;console.log(JSON.stringify({screenPagination:true,content:report.content,viewports:report.viewports}));return report;
  }finally{fs.writeFileSync(path.join(out,'regression.json'),JSON.stringify(report,null,2));}
}
module.exports={run};
if(require.main===module)(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{await run(browser);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
