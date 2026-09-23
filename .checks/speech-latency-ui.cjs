'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'speech-latency-1.18');
const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
const voices=JSON.parse(fs.readFileSync(path.join(root,'content/voices/online-voices.json'))).voices;
const sample=fs.readFileSync(path.join(__dirname,'online-voice-1.16/android-protocol-zh-CN-XiaoxiaoNeural.mp3'));
const requests=[],report={completed:false,checks:[],cachedActivities:[],errors:[],fixture:'Previously verified MP3; local responses simulate synthesis, Android bridge is simulated'};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let responseDelay=20;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/speech/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({available:true,voices}));return;}
  if(url.pathname==='/api/speech'){
    const item={text:url.searchParams.get('text'),voice:url.searchParams.get('voice'),rate:Number(url.searchParams.get('rate')),prefetch:req.headers['x-speech-prefetch']==='1',cancelled:false};requests.push(item);
    const timer=setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':sample.length,'Cache-Control':'no-store'});res.end(sample);}},responseDelay);
    res.on('close',()=>{clearTimeout(timer);if(!res.writableEnded)item.cancelled=true;});return;
  }
  if(url.pathname.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
});
async function mode(page,value){await page.evaluate(value=>location.hash=value,value);await page.waitForFunction(value=>document.body.dataset.mode===value.split('/')[0],value);}
async function solveCipher(page){
  for(let slot=0;slot<3;slot++){
    const id=await page.evaluate(index=>{const code=document.querySelectorAll('#codeList .code')[index],column=code.querySelector('.code-number').textContent,row=PictureCipher.rows.findIndex(item=>code.querySelector('.code-caption').textContent.includes(item.name+'色行'));return document.querySelector('#matrix .card[data-column="'+column+'"][data-row="'+row+'"]').dataset.card;},slot);
    await page.locator('#matrix [data-card="'+id+'"]').click();
  }
  await page.locator('#winConfirm').click();
}
async function cachedPlayback(page,selector,label){
  await delay(900);const before=requests.length;
  await page.evaluate(()=>{window.__playing=[];});await page.locator(selector).click();
  await page.waitForFunction(()=>window.__playing.length>0);
  const played=await page.evaluate(()=>window.__playing[0]);
  assert.ok(played.src.startsWith('blob:'),label+' uses prepared audio');assert.ok(played.duration>0,label+' decodes and plays');
  assert.equal(requests.slice(before).filter(item=>!item.prefetch).length,0,label+' needs no foreground audio request');
  report.cachedActivities.push(label);return played;
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    await context.addInitScript(voice=>{
      localStorage.setItem('tongqu-global-voice-v1',JSON.stringify({voiceId:voice.id,rate:.9}));
      Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});
      window.__playing=[];document.addEventListener('playing',event=>{if(event.target instanceof HTMLAudioElement)window.__playing.push({src:event.target.currentSrc,duration:event.target.duration});},true);
    },voices[0]);
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(base+'/#home');await page.waitForFunction(()=>GlobalVoice.source()==='server'&&GlobalVoice.voiceId().startsWith('online:'));
    await cachedPlayback(page,'#homeVoiceTest','home');
    await page.evaluate(()=>GlobalVoice.stopAll());await context.setOffline(true);await cachedPlayback(page,'#homeVoiceTest','cached home while offline');await context.setOffline(false);
    for(const [activity,selector] of [['count','#countSpeak'],['shadow','#shadowSpeak'],['pattern','#patternSpeak'],['sort','#speakSortPrompt'],['cipher','#speakAnswerView'],['poetry/ts-011','#poetrySpeak'],['train','#trainPlay']]){
      await mode(page,activity);if(activity==='cipher')await solveCipher(page);if(activity==='sort')await page.locator('#sortToggleAnswer').click();
      await cachedPlayback(page,selector,activity);
    }
    await page.locator('[data-train-mode="repeat"]').click();await cachedPlayback(page,'#trainPlay','nine-character repeat');
    await page.locator('#trainChunks').click();await cachedPlayback(page,'[data-listen-part="0"]','repeat phrase');await page.locator('#listenDialogClose').click();
    assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null);
    report.checks.push('Prepared MP3 audio starts real browser playback in every speech activity without another foreground request; cached playback works offline');
    await mode(page,'home');await page.locator('#globalVoiceSelect').selectOption(voices[1].id);await page.locator('#globalRateSelect').selectOption('1.05');
    const offset=requests.length;await cachedPlayback(page,'#homeVoiceTest','changed voice and speed');
    assert.ok(requests.slice(offset).some(item=>item.voice===voices[1].id&&item.rate===1.05&&item.prefetch));
    report.checks.push('Voice and rate changes prepare the new selection rather than reuse another voice or rate');
    await mode(page,'shadow');await delay(900);responseDelay=650;
    await page.evaluate(()=>GameVoice.prepare(['等待时换题的声音。'],{owner:'shadow'}));await delay(180);
    await mode(page,'pattern');await delay(800);assert.ok(requests.some(item=>item.text==='等待时换题的声音。'&&item.cancelled));
    assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null);responseDelay=20;
    report.checks.push('Leaving an activity aborts obsolete preparation and never starts its audio');
    await mode(page,'home');await page.screenshot({path:path.join(out,'home.png')});await context.close();
    const native=await browser.newContext({viewport:{width:390,height:844}});
    await native.addInitScript(voices=>{
      localStorage.setItem('tongqu-global-voice-v1',JSON.stringify({voiceId:voices[0].id,rate:.9}));
      window.__spoken=[];window.__prepared=[];window.__cancelledPreparation=0;window.__voice='';
      window.AndroidTts={isReady(){return true;},listVoices(){return JSON.stringify(voices);},setVoice(id){window.__voice=id;},stop(){},
        prepare(texts,rate,voice){window.__prepared.push({texts:JSON.parse(texts),rate,voice});},cancelPreparation(){window.__cancelledPreparation++;},
        speak(text,rate){window.__spoken.push({text,rate,voice:window.__voice});},
        speakWithId(text,rate,id){window.__spoken.push({text,rate,id,voice:window.__voice});queueMicrotask(()=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}})));}};
    },voices);
    const n=await native.newPage();n.on('pageerror',error=>report.errors.push('native: '+error.message));await n.goto(base+'/#home');await n.waitForFunction(()=>GlobalVoice.source()==='android');
    await mode(n,'poetry/ts-250');await delay(220);await n.locator('#poetrySpeak').click();
    const expected=await n.evaluate(()=>{const poem=TangPoetry.poems.find(p=>p.id==='ts-250');return poem.title+'。'+poem.author+'。'+poem.verses.map(v=>v.text).join('');});
    const parts=[];
    while(await n.locator('#poetryStop').isVisible()){
      assert.ok(parts.length<20,'Long poem must finish');await delay(180);
      const state=await n.evaluate(()=>({spoken:__spoken.at(-1),prepared:__prepared.at(-1)}));
      assert.ok(state.prepared.texts.includes(state.spoken.text),'Preparation contains current segment');assert.ok(state.prepared.texts.length<=3);
      assert.equal(state.prepared.voice,state.spoken.voice);assert.equal(state.prepared.rate,state.spoken.rate);parts.push(state.spoken.text);
      await n.evaluate(id=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'end'}})),state.spoken.id);
    }
    assert.equal(parts.join(''),expected);assert.ok(parts[0].length<=80&&parts.length>3);report.longPoemSegments=parts.length;
    report.checks.push('Long-poem segments retain all text, prepare upcoming segments and share the selected native voice and speed');
    await n.locator('#poetrySpeak').click();const old=await n.evaluate(()=>__spoken.at(-1));await n.locator('#poetryBackCatalog').click();const count=await n.evaluate(()=>__spoken.length);
    await n.evaluate(id=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'end'}})),old.id);assert.equal(await n.evaluate(()=>__spoken.length),count);
    await mode(n,'train');await n.locator('#trainPlay').click();await n.locator('[data-train-mode="repeat"]').click();await n.locator('#trainPlay').click();
    assert.match(await n.evaluate(()=>__spoken.at(-1).text),/^\p{Script=Han}{9}。$/u);
    await n.locator('#trainChunks').click();await n.locator('[data-listen-part="0"]').click();await n.locator('#listenDialogClose').click();
    const cancellations=await n.evaluate(()=>__cancelledPreparation);await n.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.ok(await n.evaluate(()=>__cancelledPreparation)>cancellations);await native.close();
    report.checks.push('Native stale completion events are ignored; switching listening type while playing succeeds; backgrounding cancels preparation');
    assert.deepEqual(report.errors,[]);report.completed=true;
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'ui.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
