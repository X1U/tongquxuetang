'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'poetry');
fs.mkdirSync(out,{recursive:true});
const file=path.join(root,'app/src/main/assets/index.html'),url=pathToFileURL(file).href;
const data=JSON.parse(fs.readFileSync(path.join(root,'content/poetry/poems.json'),'utf8'));
const ordered=[...data.poems].sort((a,b)=>['five','seven','mixed'].indexOf(a.meter)-['five','seven','mixed'].indexOf(b.meter)||['jue','lv','gu','yuefu'].indexOf(a.genre)-['jue','lv','gu','yuefu'].indexOf(b.genre)||a.number-b.number);
const smoke=process.argv.includes('--smoke');
const report={completed:false,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),data:{},layouts:[],behavior:[],audio:[]};
const errors=[];
async function frame(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function resultCount(page,total){
  await page.waitForFunction(total=>Number(document.getElementById('poetryList').dataset.total)===total,total);
  assert.equal(await page.locator('[data-poetry-id]').count(),Math.min(Number(await page.locator('#poetryList').getAttribute('data-page-size')),total));
}
async function search(page,query){await page.locator('#poetrySearch').fill(query);await page.waitForFunction(query=>JSON.parse(localStorage.getItem('picture-learning-poetry-v1')||'{}').query===query,query);}
async function navigate(page,id){await page.evaluate(id=>location.hash='#poetry/'+id,id);await page.waitForFunction(id=>document.querySelector('#poetryPoemTitle').getAttribute('aria-label')===window.TangPoetry.poems.find(p=>p.id===id).title,id);await frame(page);}
async function layout(page,tag,selector='#poetryScreen'){
  await frame(page);
  const issues=await page.evaluate(selector=>{
    const issues=[];
    if(document.documentElement.scrollWidth>innerWidth+1)issues.push('page overflow');
    for(const el of document.querySelectorAll(selector+' button,'+selector+' input,'+selector+' figure')){
      if(!el.getClientRects().length)continue;
      const b=el.getBoundingClientRect();
      if(b.left<-.5||b.right>innerWidth+.5)issues.push((el.id||el.className)+': outside horizontal viewport');
      if(b.height<1||b.width<1)issues.push((el.id||el.className)+': empty');
    }
    if(!document.getElementById('poetryReader').hidden&&!document.getElementById('poetryReadPanel').hidden){
      for(const el of document.querySelectorAll('.poetry-verse:not(.is-long)')){
        const chars=[...el.querySelectorAll('ruby>span')].map(s=>s.getBoundingClientRect());
        if(chars.length<=7&&Math.max(...chars.map(b=>b.top))-Math.min(...chars.map(b=>b.top))>3)issues.push(el.getAttribute('aria-label')+': wrapped short verse');
        const sounds=[...el.querySelectorAll('rt')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());
        for(let i=1;i<sounds.length;i++)if(sounds[i].left<sounds[i-1].right-1&&Math.abs(sounds[i].top-sounds[i-1].top)<2)issues.push(el.getAttribute('aria-label')+': pinyin overlap');
      }
    }
    return [...new Set(issues)];
  },selector);
  await page.screenshot({path:path.join(out,tag+'.png'),fullPage:!tag.includes('catalog')});
  report.layouts.push({tag,issues});assert.deepEqual(issues,[],tag);
}
function contentChecks(){
  assert.equal(data.poems.length,320);assert.equal(new Set(data.poems.map(p=>p.id)).size,320);
  assert.equal(data.poems.find(p=>p.number===228).verses.length,24);
  for(const p of data.poems){
    assert.ok(p.meaning.length>=30&&p.notes.length>=3&&p.pictureCaption.length>=12);
    for(const v of p.verses){assert.equal(v.tokens.map(t=>t[0]).join(''),v.text);assert.ok(!/[?!,;]/.test(v.text));}
    assert.equal(p.titleTokens.map(t=>t[0]).join(''),p.title);assert.equal(p.authorTokens.map(t=>t[0]).join(''),p.author);
    assert.ok(!p.title.includes('…'));
  }
  const reading=(id,word)=>{const p=data.poems.find(p=>p.number===id),tokens=p.verses.flatMap(v=>v.tokens),text=tokens.map(t=>t[0]).join(''),i=text.indexOf(word);assert.ok(i>=0,word);return tokens.slice(i,i+word.length).map(t=>t[1]).join(' ');};
  assert.equal(reading(5,'应知'),'yīng zhī');assert.equal(reading(5,'着花'),'zhuó huā');assert.equal(reading(71,'少小'),'shào xiǎo');assert.equal(reading(40,'一日还'),'yī rì huán');assert.equal(reading(228,'参与商'),'shēn yǔ shāng');assert.equal(reading(85,'天都'),'tiān dū');
  assert.equal(data.poems.find(p=>p.author==='温庭筠').authorTokens.map(t=>t[1]).join(' '),'wēn tíng jūn');
  assert.match(data.license,/MIT License/);assert.match(data.license,/JackeyGao/);
  assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync(path.join(root,'../密码图卡乐园/密码图卡乐园.html'),'utf8'));
  report.data={poems:320,annotated:320,scenes:new Set(data.poems.map(p=>p.scene)).size,completeWeiPoem:true,pinyinSamples:true,standaloneIdentical:true};
}
async function behaviorChecks(browser){await require('./tongqu-preview.cjs').run(browser);report.behavior.push('complete reader, continuous catalog, search, directory, saved reading and storage fallback');}
async function nativeChecks(browser){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>{window.__spoken=[];window.__stops=0;window.AndroidTts={speak(text,rate){window.__spoken.push({text,rate,legacy:true});},speakWithId(text,rate,id){window.__spoken.push({text,rate,id});window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}}));},stop(){window.__stops++;},isReady(){return true;},installChineseVoice(){}};});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'#poetry/ts-250');await frame(page);await page.locator('#poetrySpeak').click();
  for(let i=0;i<12&&await page.locator('#poetryStop').isVisible();i++){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id:window.__spoken.at(-1).id,state:'end'}})));}
  const spoken=await page.evaluate(()=>window.__spoken);assert.ok(spoken.length>=4);assert.ok(spoken.every(x=>x.text.length<=220));const p=data.poems.find(p=>p.number===250);assert.equal(spoken.map(x=>x.text).join(''),p.title+'。'+p.author+'。'+p.verses.map(v=>v.text).join(''));assert.equal(await page.locator('#poetryStop').isVisible(),false);
  await navigate(page,'ts-011');await page.locator('[data-poetry-verse="0"]').click();const stale=await page.evaluate(()=>window.__spoken.at(-1).id);await page.locator('[data-poetry-verse="1"]').click();const count=await page.evaluate(()=>window.__spoken.length);await page.evaluate(id=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'end'}})),stale);assert.equal(await page.evaluate(()=>window.__spoken.length),count);assert.equal(await page.locator('[data-poetry-verse="1"]').getAttribute('class'),'poetry-verse is-speaking');
  await page.locator('#poetryBackCatalog').click();await frame(page);assert.equal(await page.locator('#poetryStop').isVisible(),false);assert.ok(await page.evaluate(()=>window.__stops)>0);
  report.audio.push({native:'simulated Android bridge completion events',longPoemSegments:spoken.length,maxChars:Math.max(...spoken.map(x=>x.text.length)),lateCallbackIgnored:true,returnStops:true});await context.close();
}
(async()=>{
  contentChecks();
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const sizes=smoke?[{width:320,height:568},{width:1280,height:900}]:[{width:320,height:568},{width:360,height:640},{width:412,height:915},{width:760,height:900},{width:1280,height:900}];
    for(const viewport of sizes){
      const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url+'#home');await layout(page,viewport.width+'-home','#homeScreen');assert.equal(await page.locator('[data-open-mode]').count(),6);
      await page.locator('[data-open-mode="poetry"]').click();await frame(page);await resultCount(page,320);await layout(page,viewport.width+'-catalog');
      for(const id of (smoke?['ts-011','ts-040']:['ts-011','ts-040','ts-113','ts-250','ts-293'])){await navigate(page,id);await layout(page,viewport.width+'-'+id);}
      await navigate(page,'ts-020');await page.locator('#poetryExplainTab').click();await layout(page,viewport.width+'-explanation');
      await context.close();
    }
    if(!smoke){await behaviorChecks(browser);await nativeChecks(browser);}
    assert.deepEqual(errors,[],'No script errors');report.completed=true;console.log(JSON.stringify({completed:true,mode:smoke?'smoke':'full',data:report.data,layouts:report.layouts.length,behavior:report.behavior,audio:report.audio}));
  }finally{await browser.close();fs.writeFileSync(path.join(out,smoke?'smoke-report.json':'report.json'),JSON.stringify({...report,errors},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
