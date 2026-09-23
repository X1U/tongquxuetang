'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'global-voice-1.15'),key='tongqu-global-voice-v1';
fs.mkdirSync(out,{recursive:true});
const report={completed:false,checks:[],engines:[],errors:[]};
function mockEngines({engine,seed=true}){
  window.__spoken=[];window.__stops=0;window.__nativeReady=false;window.__browserReady=engine!=='browser';
  window.__nativeVoice='';const listeners=[];
  const voices=[{id:engine+'-a',name:'中文声音甲',lang:'zh-CN',local:true},{id:engine+'-b',name:'中文声音乙',lang:'zh-CN',local:true},{id:'english',name:'English',lang:'en-US',local:true}];
  if(seed)try{if(!localStorage.getItem('tongqu-global-voice-v1'))localStorage.setItem('tongqu-global-voice-v1',JSON.stringify({voiceId:engine+'-b',rate:.78}));}catch(_){}
  window.SpeechSynthesisUtterance=function(text){this.text=text;};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
    getVoices(){return window.__browserReady?voices.map(v=>({...v,voiceURI:v.id,localService:true})):[];},
    addEventListener(name,callback){if(name==='voiceschanged')listeners.push(callback);},
    cancel(){window.__stops++;},resume(){},speak(u){window.__spoken.push({text:u.text,rate:u.rate,voice:u.voice?.voiceURI});u.onstart?.();}
  }});
  window.__showBrowserVoices=()=>{window.__browserReady=true;listeners.forEach(fn=>fn());};
  if(engine==='android')window.AndroidTts={
    isReady(){return window.__nativeReady;},listVoices(){return JSON.stringify(window.__nativeReady?voices:[]);},
    setVoice(id){window.__nativeVoice=id;},stop(){window.__stops++;},installChineseVoice(){},
    speak(text,rate){window.__spoken.push({text,rate,voice:window.__nativeVoice});},
    speakWithId(text,rate,id){window.__spoken.push({text,rate,id,voice:window.__nativeVoice});window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}}));}
  };
  HTMLMediaElement.prototype.play=function(){
    const src=this.getAttribute('src');
    if(src?.startsWith('/api/speech?')){const params=new URL(src,location.href).searchParams;window.__spoken.push({text:params.get('text'),rate:Number(params.get('rate')),voice:params.get('voice')});}
    this.dispatchEvent(new Event('playing'));return Promise.resolve();
  };
}
async function gotoMode(page,mode){await page.evaluate(mode=>location.hash=mode,mode);await page.waitForFunction(mode=>document.body.dataset.mode===mode.split('/')[0],mode);}
async function ready(page,engine){
  await page.waitForFunction(()=>!!window.GlobalVoice);
  if(engine==='android')await page.evaluate(async()=>{window.__nativeReady=true;await GlobalVoice.refresh();});
  if(engine==='browser')await page.evaluate(async()=>{window.__showBrowserVoices();await GlobalVoice.refresh();});
  await page.waitForFunction(()=>GlobalVoice.voices().length===2);
}
async function spoken(page,selector,rate,voice){
  const before=await page.evaluate(()=>window.__spoken.length);await page.locator(selector).click();
  await page.waitForFunction(before=>window.__spoken.length>before,before);
  const last=await page.evaluate(()=>window.__spoken.at(-1));assert.equal(last.rate,rate,selector+' rate');assert.equal(last.voice,voice,selector+' voice');return last;
}
async function cipherAnswer(page){
  for(let slot=0;slot<3;slot++){
    const id=await page.evaluate(index=>{const code=document.querySelectorAll('#codeList .code')[index],column=code.querySelector('.code-number').textContent,row=PictureCipher.rows.findIndex(item=>code.querySelector('.code-caption').textContent.includes(item.name+'色行'));return document.querySelector('#matrix .card[data-column="'+column+'"][data-row="'+row+'"]').dataset.card;},slot);
    await page.locator('#matrix [data-card="'+id+'"]').click();
  }
  await page.locator('#winConfirm').click();
}
(async()=>{
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,file=pathToFileURL(path.join(root,'app/src/main/assets/index.html')).href;
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    for(const engine of ['server','android','browser']){
      const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});await context.addInitScript(mockEngines,{engine});
      if(engine==='server')await context.route('**/api/speech/status',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,voices:[{id:'server-a',name:'Microsoft Huihui',lang:'zh-CN'},{id:'server-b',name:'Microsoft Yaoyao',lang:'zh-CN'},{id:'english',name:'English',lang:'en-US'}]})}));
      const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',error=>report.errors.push(engine+': '+error.message));await p.goto((engine==='browser'?file:base)+'#home');
      if(engine!=='server'){
        await p.evaluate(()=>GlobalVoice.refresh());assert.equal(await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).voiceId,key),engine+'-b','Loading must preserve the saved voice');
        assert.equal(await p.evaluate(()=>GlobalVoice.source()),engine);
      }
      await ready(p,engine);assert.equal(await p.locator('#globalVoiceSelect').inputValue(),engine+'-b');assert.equal(await p.locator('#globalRateSelect').inputValue(),'0.78');
      assert.equal(await p.locator('#globalRateSelect option').count(),5);assert.equal(await p.locator('#globalVoiceSelect option').count(),3);
      assert.equal(await p.locator('#slowSpeech,#answerViewSlow,#sortSlowSpeech,#poetrySlow,#trainSlow').count(),0);
      for(const rate of ['0.65','0.78','0.90','1.05','1.20']){
        await p.locator('#globalRateSelect').selectOption(rate);assert.equal(await p.locator('#homeVoiceTest').getAttribute('aria-busy'),null);await spoken(p,'#homeVoiceTest',Number(rate),engine+'-b');
      }
      await p.locator('#globalVoiceSelect').selectOption(engine+'-a');await spoken(p,'#homeVoiceTest',1.2,engine+'-a');
      await p.locator('#globalVoiceSelect').selectOption(engine+'-b');await p.reload();await ready(p,engine);
      assert.equal(await p.locator('#globalVoiceSelect').inputValue(),engine+'-b');assert.equal(await p.locator('#globalRateSelect').inputValue(),'1.20');
      const tested=[];
      for(const [mode,selector] of [['count','#countSpeak'],['shadow','#shadowSpeak'],['pattern','#patternSpeak'],['sort','#speakSortPrompt'],['cipher','#speakAnswerView'],['poetry/ts-011','#poetrySpeak'],['train','#trainPlay']]){
        await gotoMode(p,mode);if(mode==='cipher')await cipherAnswer(p);if(mode==='sort')await p.locator('#sortToggleAnswer').click();
        await spoken(p,selector,1.2,engine+'-b');tested.push(mode);
        if(mode.startsWith('poetry')){const previous=await p.evaluate(()=>window.__spoken.at(-1));await p.evaluate(()=>GlobalVoice.stopAll());assert.equal(await p.locator('#poetryStop').isVisible(),false);if(previous.id){const count=await p.evaluate(()=>__spoken.length);await p.evaluate(id=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'end'}})),previous.id);assert.equal(await p.evaluate(()=>__spoken.length),count,'Cancelled poem must not start its next segment');}}
      }
      await p.locator('[data-train-mode="repeat"]').click();await spoken(p,'#trainPlay',1.2,engine+'-b');
      await p.locator('#trainChunks').click();await spoken(p,'[data-listen-part="0"]',1.2,engine+'-b');await p.locator('#listenDialogClose').click();
      await gotoMode(p,'sound');const prior=await p.evaluate(()=>__spoken.length);await p.locator('#soundPlay').click();assert.equal(await p.locator('#listeningMedia').evaluate(a=>a.playbackRate),1);assert.equal(await p.evaluate(()=>__spoken.length),prior,'Real recordings must stay independent of synthesized speech');
      await gotoMode(p,'home');await p.evaluate(key=>localStorage.setItem(key,JSON.stringify({voiceId:'removed-voice',rate:.78})),key);await p.reload();await ready(p,engine);assert.equal(await p.locator('#globalVoiceSelect').inputValue(),'');assert.equal(await p.locator('#globalRateSelect').inputValue(),'0.78');
      report.engines.push({engine,modes:tested,allFiveRates:true,voiceSwitch:true,reload:true,missingVoiceFallback:true,realRecordingsUnchanged:true});
      await context.close();console.log(engine+' global voice checks passed');
    }
    const denied=await browser.newContext();await denied.addInitScript(mockEngines,{engine:'browser',seed:false});await denied.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage denied','SecurityError');};Storage.prototype.getItem=function(){throw new DOMException('Storage denied','SecurityError');};});
    const page=await denied.newPage();page.on('pageerror',error=>report.errors.push('storage: '+error.message));await page.goto(file+'#home');await ready(page,'browser');await page.locator('#globalVoiceSelect').selectOption('browser-b');await page.locator('#globalRateSelect').selectOption('0.65');await spoken(page,'#homeVoiceTest',.65,'browser-b');await denied.close();
    report.checks.push('All seven speech activities and home use the selected voice and rate in server, Android bridge and browser paths','Delayed engine startup preserves the saved choice; unavailable choices fall back safely','Five speed options persist across reloads; retired slow-reading checkboxes are absent','Cancelling poetry prevents stale callbacks from starting another segment','Real sound recordings remain at normal speed','Denied storage still permits selecting a voice and speaking');
    assert.deepEqual(report.errors,[]);report.completed=true;
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'regression.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
