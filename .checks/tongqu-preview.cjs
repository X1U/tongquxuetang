'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'content/poetry/poems.json'),'utf8')).version,out=path.join(__dirname,'tongqu-'+version);fs.mkdirSync(out,{recursive:true});
const file=pathToFileURL(path.join(root,'app/src/main/assets/index.html')).href;
const report={completed:false,screens:[],content:null,filters:[],errors:[]};
const frame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function run(browser){
 const ownsBrowser=!browser;
 if(!browser)browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  for(const [width,height] of [[320,568],[360,640],[390,844],[412,915],[760,900],[1280,900],[568,320]]){
   const c=await browser.newContext({viewport:{width,height}}),p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));
   await p.goto(file+'#poetry/ts-085');await frame(p);assert.equal(await p.locator('[data-poetry-verse]').count(),8);assert.equal(await p.locator('#poetryReaderPage,#poetryReaderPrevious,#poetryReaderNext').count(),0);
   assert.equal(await p.locator('#poetryBook #poetryPoemTitle').count(),1);assert.equal(await p.locator('#poetryBook #poetryAuthor').count(),1);
   const measure=await p.evaluate(()=>{
    const b=document.getElementById('poetryBook'),r=b.getBoundingClientRect(),buttons=[...document.querySelectorAll('[data-poetry-verse]')],boxes=buttons.map(e=>e.getBoundingClientRect());
    return {book:{height:b.clientHeight,scrollHeight:b.scrollHeight,width:b.clientWidth,scrollWidth:b.scrollWidth},allVisible:boxes.every(x=>x.top>=r.top&&x.bottom<=r.bottom+1),paired:Math.abs(boxes[0].top-boxes[1].top)<1,font:getComputedStyle(buttons[0]).fontSize,rootScroll:document.documentElement.scrollHeight-innerHeight,backHeight:document.getElementById('poetryBackCatalog').getBoundingClientRect().height,footerBottom:document.querySelector('.poetry-reader-footer').getBoundingClientRect().bottom};
   });
   assert.equal(measure.paired,true);assert.equal(measure.rootScroll,0);assert.ok(measure.book.scrollWidth<=measure.book.width+1);assert.ok(measure.backHeight>=44);assert.ok(measure.footerBottom<=height);if(height>=568)assert.equal(measure.allVisible,true,'All eight verses fit on a portrait screen');
   report.screens.push({width,height,...measure});await p.screenshot({path:path.join(out,`${width}-zhongnanshan.png`)});
   await p.locator('#poetryPinyin').uncheck();assert.equal(await p.locator('#poetryBook rt:visible').count(),0);await p.locator('#poetryPinyin').check();assert.ok(await p.locator('#poetryBook rt:visible').count()>0);
   await p.locator('#poetryExplainTab').click();
   assert.equal(await p.locator('#poetryIllustration,.poetry-figure').count(),0);assert.equal(await p.locator('[data-poetry-study]:visible').count(),5);
   for(const section of ['translation','notes','background','analysis','appreciation']){
    await p.locator(`[data-poetry-study="${section}"]`).click();await frame(p);
    assert.equal(await p.locator(`[data-poetry-study="${section}"]`).getAttribute('aria-selected'),'true');
    const space=await p.locator('#poetryBook').evaluate(e=>({height:e.clientHeight,overflow:e.scrollWidth-e.clientWidth,root:document.documentElement.scrollHeight-innerHeight,footer:document.querySelector('.poetry-reader-footer').getBoundingClientRect().bottom}));
    assert.equal(space.root,0);assert.ok(space.overflow<=1);assert.ok(space.height>=90,'Explanations need readable space on '+width+'x'+height);assert.ok(space.footer<=height);
    if(section==='notes')assert.equal(await p.locator('#poetryExplanation [data-poetry-word]').count(),3);
   }
   await p.locator('[data-poetry-study="translation"]').click();await p.screenshot({path:path.join(out,`${width}-explanation.png`)});
   await p.locator('#backHome').click();assert.equal(await p.locator('.brand-name').textContent(),'童趣学堂');assert.equal(await p.locator('[data-open-mode]').count(),9);await p.screenshot({path:path.join(out,`${width}-home.png`)});await c.close();
  }
  const c=await browser.newContext({viewport:{width:390,height:844}}),p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto(file+'#poetry');await frame(p);
  const catalog=await p.evaluate(()=>{const select=document.querySelector('[data-poetry-page-select]'),ids=[],indices=[];for(const option of [...select.options]){select.value=option.value;select.dispatchEvent(new Event('change'));for(const card of document.querySelectorAll('[data-poetry-id]')){ids.push(card.dataset.poetryId);indices.push(Number(card.querySelector('.poetry-card-index').textContent));}}return {ids,indices};});
  assert.equal(new Set(catalog.ids).size,320);assert.deepEqual(catalog.indices,Array.from({length:320},(_,i)=>i+1));assert.equal(catalog.ids[29],'ts-081');
  await p.locator('[data-poetry-page-select]').selectOption('5');await p.screenshot({path:path.join(out,'catalog-continuous-numbering.png')});
  await p.locator('#poetryOpenDirectory').click();await p.locator('[data-poetry-directory="five/lv"]').click();assert.equal(await p.locator('#poetryList').getAttribute('data-total'),'80');
  await p.locator('[data-poetry-meter="seven"]').click();assert.equal(await p.locator('#poetryList').getAttribute('data-total'),'148');assert.equal(await p.locator('#poetryGenre').inputValue(),'all');
  await p.locator('#poetrySearch').fill('李白');await p.locator('#poetrySearch').press('Enter');await p.locator('#poetryOpenDirectory').click();
  for(let i=0;i<10&&!await p.locator('[data-poetry-directory="mixed/yuefu"]').count();i++)await p.locator('#poetrySheetNext').click();
  await p.locator('[data-poetry-directory="mixed/yuefu"]').click();assert.equal(await p.locator('#poetryList').getAttribute('data-total'),'10');assert.equal(await p.locator('#poetrySearch').inputValue(),'');
  await p.locator('[data-poetry-meter="five"]').click();assert.equal(await p.locator('#poetryList').getAttribute('data-total'),'162');assert.equal(await p.locator('#poetryGenre').inputValue(),'all');
  report.filters.push('All 320 continuous indices, directory → quick category, search → other directory, genre synchronization and page reset');
  await p.setViewportSize({width:320,height:568});await frame(p);
  report.content=await p.evaluate(async()=>{
    const pause=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));let verses=0,notes=0,studySections=0;
    for(const poem of window.TangPoetry.poems){
      history.replaceState(null,'','#poetry/'+poem.id);window.dispatchEvent(new Event('hashchange'));await pause();
      const shown=[...document.querySelectorAll('[data-poetry-verse]')].map(el=>[...el.querySelectorAll('ruby>span,.poetry-punctuation')].map(s=>s.textContent).join(''));
      if(JSON.stringify(shown)!==JSON.stringify(poem.verses.map(v=>v.text)))throw Error('Incomplete poem '+poem.id);
      const book=document.getElementById('poetryBook');if(book.scrollWidth>book.clientWidth+1)throw Error('Horizontal overflow '+poem.id);
      for(const line of document.querySelectorAll('.poetry-verse')){
        const sounds=[...line.querySelectorAll('rt')].map(e=>e.getBoundingClientRect());
        for(let i=1;i<sounds.length;i++)if(sounds[i].left<sounds[i-1].right-1&&Math.abs(sounds[i].top-sounds[i-1].top)<2)throw Error('Pinyin overlap '+poem.id);
      }
      if(document.querySelector('#poetryPoemTitle').getAttribute('aria-label')!==poem.title)throw Error('Incomplete title '+poem.id);
      document.getElementById('poetryExplainTab').click();
      for(const section of ['translation','notes','background','analysis','appreciation']){
        document.querySelector(`[data-poetry-study="${section}"]`).click();
        const explained=[...document.querySelectorAll('#poetryExplanation [data-poetry-fragment-text]')].map(e=>e.textContent);
        const expected=section==='notes'?poem.notes.map(n=>n.meaning):[poem.study[section]].flat();
        if(!expected.length||JSON.stringify(explained)!==JSON.stringify(expected))throw Error('Incomplete '+section+' '+poem.id);
        if(book.scrollWidth>book.clientWidth+1)throw Error('Study horizontal overflow '+poem.id+' '+section);
        studySections++;
      }
      const source=document.getElementById('poetryReference');
      if(source.href!==poem.reference.url||new URL(source.href).origin!=='https://hanyu.baidu.com'||source.target!=='_blank'||!source.rel.includes('noopener'))throw Error('Invalid source link '+poem.id);
      if('pictureCaption' in poem||'scene' in poem||document.querySelector('#poetryIllustration'))throw Error('Retired detail picture '+poem.id);
      verses+=shown.length;notes+=poem.notes.length;
    }
    return {poems:320,verses,notes,studySections};
  });
  await p.goto(file+'#poetry/ts-250');await frame(p);await p.locator('#poetryBook').evaluate(e=>e.scrollTop=e.scrollHeight);await frame(p);
  const end=await p.locator('[data-poetry-verse]').last().boundingBox(),book=await p.locator('#poetryBook').boundingBox();assert.ok(end.y+end.height<=book.y+book.height+1);assert.equal(await p.evaluate(()=>scrollY),0);await p.screenshot({path:path.join(out,'long-poem-end.png')});
  const readPosition=await p.locator('#poetryBook').evaluate(e=>e.scrollTop);
  await p.locator('#poetryExplainTab').click();await p.locator('[data-poetry-study="translation"]').click();await frame(p);assert.equal(await p.locator('#poetryBook').evaluate(e=>e.scrollTop),0);
  await p.locator('#poetryBook').evaluate(e=>e.scrollTop=100);await frame(p);
  await p.locator('#poetryReadTab').click();await frame(p);assert.ok(Math.abs(await p.locator('#poetryBook').evaluate(e=>e.scrollTop)-readPosition)<2);
  await p.locator('#poetryExplainTab').click();await frame(p);assert.equal(await p.locator('#poetryBook').evaluate(e=>e.scrollTop),100);
  await p.locator('[data-poetry-study="notes"]').click();await frame(p);assert.equal(await p.locator('#poetryBook').evaluate(e=>e.scrollTop),0);await p.locator('#poetryBook').evaluate(e=>e.scrollTop=60);await frame(p);
  await p.locator('[data-poetry-study="translation"]').click();await frame(p);assert.equal(await p.locator('#poetryBook').evaluate(e=>e.scrollTop),100);
  await p.locator('[data-poetry-study="translation"]').focus();await p.keyboard.press('ArrowRight');assert.equal(await p.locator('[data-poetry-study="notes"]').getAttribute('aria-selected'),'true');assert.equal(await p.locator('#poetryStudyContent').getAttribute('aria-labelledby'),'poetryStudyNotes');
  await p.keyboard.press('End');assert.equal(await p.locator('[data-poetry-study="appreciation"]').getAttribute('tabindex'),'0');await p.keyboard.press('Home');assert.equal(await p.locator('[data-poetry-study="translation"]').getAttribute('aria-selected'),'true');
  assert.equal(await p.evaluate(()=>window.TangPoetryUI.back()),true);await frame(p);assert.equal(await p.locator('#poetryReadTab').getAttribute('aria-selected'),'true');
  await p.locator('#poetryBackCatalog').click();await p.locator('#poetryResume').click();await frame(p);assert.ok(Math.abs(await p.locator('#poetryBook').evaluate(e=>e.scrollTop)-readPosition)<2);
  await p.locator('#poetryPinyin').uncheck();await p.reload();await frame(p);assert.equal(await p.locator('#poetryPinyin').isChecked(),false);assert.equal(await p.locator('#poetryBook rt:visible').count(),0);await p.locator('#poetryPinyin').check();
  await p.locator('#poetryBackCatalog').click();await p.locator('[data-poetry-meter="all"]').click();await p.locator('[data-poetry-page-select]').selectOption('5');
  const firstId=await p.locator('[data-poetry-id]').first().getAttribute('data-poetry-id');await p.locator('[data-poetry-id]').first().click();await p.locator('#poetryNext').click();await frame(p);assert.equal(new URL(p.url()).hash,'#poetry/'+catalog.ids[catalog.ids.indexOf(firstId)+1]);
  await p.locator('#poetryPrevious').click();await frame(p);assert.equal(new URL(p.url()).hash,'#poetry/'+firstId);await p.locator('#poetryBackCatalog').click();assert.equal(await p.locator('[data-poetry-page-select]').inputValue(),'5');
  await p.locator('#poetrySearch').fill('杜甫');await p.locator('[data-poetry-meter="seven"]').click();await p.waitForTimeout(250);assert.equal(await p.locator('#poetrySearch').inputValue(),'');assert.equal(await p.locator('#poetryList').getAttribute('data-total'),'148');
  report.filters.push('Read/explain scroll positions, resume, pinyin persistence, previous/next sequence, catalog page restoration, pending-search cancellation');
  await c.close();
  const legacy=await browser.newContext({viewport:{width:320,height:568}});
  await legacy.addInitScript(()=>localStorage.setItem('picture-learning-poetry-v1',JSON.stringify({meter:'mixed',genre:'lv',query:'',page:8,lastId:'ts-085',visited:['ts-085'],pinyin:false,reading:{id:'ts-085',read:{key:'verse-4',from:0}}})));
  const old=await legacy.newPage();old.on('pageerror',e=>report.errors.push(e.message));await old.goto(file+'#poetry');await frame(old);assert.equal(await old.locator('#poetryGenre').inputValue(),'all');assert.equal(await old.locator('#poetryList').getAttribute('data-total'),'10');await old.locator('#poetryResume').click();await frame(old);assert.equal(await old.locator('#poetryBook').evaluate(e=>e.scrollTop),0);assert.equal(await old.locator('#poetryPinyin').isChecked(),false);await legacy.close();
  const denied=await browser.newContext();await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('storage denied');}}));const noStorage=await denied.newPage();noStorage.on('pageerror',e=>report.errors.push(e.message));await noStorage.goto(file+'#poetry');await noStorage.locator('#poetrySearch').fill('静夜思');await noStorage.locator('#poetrySearch').press('Enter');assert.equal(await noStorage.locator('#poetryList').getAttribute('data-total'),'1');await noStorage.locator('[data-poetry-id="ts-011"]').click();assert.equal(await noStorage.locator('[data-poetry-verse]').count(),4);await denied.close();
  report.filters.push('Previous-version records and invalid saved category migrate safely; denied storage keeps search and reading usable');
  assert.deepEqual(report.errors,[]);report.completed=true;console.log(JSON.stringify(report));
 }finally{if(ownsBrowser)await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
module.exports={run};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
