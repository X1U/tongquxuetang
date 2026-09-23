'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base='http://127.0.0.1:8765',out=path.join(__dirname,'online-voice-1.16'),report={completed:false,voices:[],activities:[],checks:[],errors:[]};
const key='tongqu-global-voice-v1';
function trackPlayback(){
  window.__playbacks=[];
  document.addEventListener('playing',event=>{
    const audio=event.target;
    if(audio instanceof HTMLAudioElement&&audio.id!=='listeningMedia')window.__playbacks.push({src:audio.currentSrc,duration:audio.duration});
  },true);
}
async function startPlaying(page,selector,voice,rate,method='click'){
  await page.evaluate(()=>{window.__playbacks=[];});
  await page.locator(selector)[method]();
  return playing(page,voice,rate);
}
async function playing(page,voice,rate){
  try{await page.waitForFunction(()=>window.__playbacks.length>0,null,{timeout:42000});}
  catch(error){report.failure=await page.evaluate(()=>{const a=document.querySelector('audio:not(#listeningMedia)');return {voice:GlobalVoice.voiceId(),homeStatus:document.getElementById('homeVoiceStatus').textContent,trainStatus:document.getElementById('trainFeedback').textContent,dialogStatus:document.getElementById('listenDialogStatus').textContent,src:a?.getAttribute('src'),paused:a?.paused,ready:a?.readyState,error:a?.error?.message};});throw error;}
  const result=await page.evaluate(()=>window.__playbacks[0]),url=new URL(result.src);
  assert.equal(url.searchParams.get('voice'),voice);assert.equal(Number(url.searchParams.get('rate')),rate);assert.ok(result.duration>0);return result;
}
async function mode(page,value){await page.evaluate(value=>location.hash=value,value);await page.waitForFunction(value=>document.body.dataset.mode===value.split('/')[0],value);}
async function cipherAnswer(page){
  for(let slot=0;slot<3;slot++){
    const id=await page.evaluate(index=>{const code=document.querySelectorAll('#codeList .code')[index],column=code.querySelector('.code-number').textContent,row=PictureCipher.rows.findIndex(item=>code.querySelector('.code-caption').textContent.includes(item.name+'色行'));return document.querySelector('#matrix .card[data-column="'+column+'"][data-row="'+row+'"]').dataset.card;},slot);
    await page.locator('#matrix [data-card="'+id+'"]').click();
  }
  await page.locator('#winConfirm').click();
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});const status=await (await fetch(base+'/api/speech/status')).json(),online=status.voices.filter(v=>v.id.startsWith('online:'));
  const expected=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../content/voices/online-voices.json'),'utf8')).voices;assert.deepEqual(online.map(v=>v.id).sort(),expected.map(v=>v.id).sort());
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:undefined,configurable:true});});
    await context.addInitScript(trackPlayback);
    const p=await context.newPage();p.on('pageerror',error=>report.errors.push(error.message));p.on('response',async response=>{if(response.status()>=400&&new URL(response.url()).pathname==='/api/speech'){report.httpErrors||=[];report.httpErrors.push({status:response.status(),voice:new URL(response.url()).searchParams.get('voice'),body:await response.text().catch(()=>''),intentional:!!report.testingOffline});}});await p.goto(base+'/#home');await p.waitForFunction(count=>GlobalVoice.voices().length===count,status.voices.length);
    assert.equal(await p.locator('#globalVoiceSelect optgroup[label^="联网"]').count(),5);
    for(const voice of process.argv.includes('--activities-only')?[]:online){
      await p.locator('#globalVoiceSelect').selectOption(voice.id);const audio=await startPlaying(p,'#homeVoiceTest',voice.id,.9,'tap');
      const response=await fetch(audio.src);assert.match(response.headers.get('content-type'),/^audio\/mpeg/);await response.arrayBuffer();
      report.voices.push({id:voice.id,name:voice.name,duration:audio.duration});console.log(voice.name+' plays in preview');
    }
    if(report.voices.length)await p.waitForFunction(()=>document.getElementById('homeVoiceStatus').textContent.includes('试播结束'),null,{timeout:25000});
    const selected=online.find(v=>v.shortName==='zh-CN-XiaoxiaoNeural');await p.locator('#globalVoiceSelect').selectOption(selected.id);await p.locator('#globalRateSelect').selectOption('1.05');
    await p.reload();await p.waitForFunction(()=>GlobalVoice.voices().length>0);assert.equal(await p.locator('#globalVoiceSelect').inputValue(),selected.id);assert.equal(await p.locator('#globalRateSelect').inputValue(),'1.05');
    for(const [activity,selector] of [['count','#countSpeak'],['shadow','#shadowSpeak'],['pattern','#patternSpeak'],['sort','#speakSortPrompt'],['cipher','#speakAnswerView'],['poetry/ts-011','#poetrySpeak'],['train','#trainPlay']]){
      await mode(p,activity);if(activity==='cipher')await cipherAnswer(p);if(activity==='sort')await p.locator('#sortToggleAnswer').click();
      await startPlaying(p,selector,selected.id,1.05);report.activities.push(activity);console.log(activity+' plays in preview');
    }
    await p.waitForFunction(()=>!document.getElementById('trainReview').disabled,null,{timeout:25000});
    await p.locator('[data-train-mode="repeat"]').click();await startPlaying(p,'#trainPlay',selected.id,1.05);report.activities.push('train/repeat');await p.locator('#trainChunks').click();await startPlaying(p,'[data-listen-part="0"]',selected.id,1.05);report.activities.push('train/phrase');await p.locator('#listenDialogClose').click();assert.equal(await p.locator('audio:not(#listeningMedia)').getAttribute('src'),null);
    await mode(p,'home');
    report.testingOffline=true;await p.route(/\/api\/speech\?/,route=>new URL(route.request().url()).searchParams.get('voice')?.startsWith('online:')?route.fulfill({status:503,body:'Online unavailable'}):route.continue());
    await p.locator('#homeVoiceTest').click();await p.waitForFunction(()=>document.getElementById('homeVoiceStatus').textContent.includes('在线声音暂时无法播放'));assert.equal(await p.locator('#homeVoiceTest').getAttribute('aria-busy'),null);assert.equal(await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).voiceId,key),selected.id);
    const local=status.voices.find(v=>!v.id.startsWith('online:'));await p.locator('#globalVoiceSelect').selectOption(local.id);await startPlaying(p,'#homeVoiceTest',local.id,1.05);await p.unroute(/\/api\/speech\?/);report.testingOffline=false;
    await p.locator('#globalVoiceSelect').selectOption(selected.id);await p.locator('#globalRateSelect').selectOption('0.90');
    // Reproduce a response arriving after the former 18/20-second UI deadlines.
    // The service itself has a 25-second synthesis deadline plus player setup.
    const slowAudio=fs.readFileSync(path.join(out,'android-protocol-zh-CN-XiaoxiaoNeural.mp3'));
    const slowRoute=async route=>{await new Promise(resolve=>setTimeout(resolve,21000));await route.fulfill({status:200,contentType:'audio/mpeg',body:slowAudio});};
    await p.route(/\/api\/speech\?/,slowRoute);await mode(p,'train');await startPlaying(p,'#trainPlay',selected.id,.9);await p.unroute(/\/api\/speech\?/,slowRoute);await mode(p,'home');
    report.checks.push('A 21-second online response still starts correctly in listening practice instead of being cancelled by an earlier UI timer');
    for(const [width,height] of [[320,568],[390,844],[568,320]]){await p.setViewportSize({width,height});await p.screenshot({path:path.join(out,`home-${width}x${height}.png`)});const fits=await p.evaluate(()=>{const r=document.querySelector('.home-voice-settings').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight;});assert.equal(fits,true);}
    for(const name of ['android-protocol-zh-CN-XiaoxiaoNeural.mp3','android-protocol-zh-HK-HiuMaanNeural.mp3']){
      const duration=await p.evaluate(async base64=>{const audio=new AudioContext(),bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const decoded=await audio.decodeAudioData(bytes.buffer);await audio.close();return decoded.duration;},fs.readFileSync(path.join(out,name)).toString('base64'));assert.ok(duration>1);
    }
    await context.close();
    const native=await browser.newContext({viewport:{width:390,height:844}});
    await native.addInitScript(voices=>{
      window.__calls=[];window.__voice='';window.AndroidTts={listVoices(){return JSON.stringify(voices);},isReady(){return window.__voice.startsWith('online:');},setVoice(id){window.__voice=id;},stop(){},speak(text,rate){window.__calls.push({voice:window.__voice,text,rate});},speakWithId(text,rate,id){window.__calls.push({voice:window.__voice,text,rate,id});window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}}));}};
    },expected);
    const n=await native.newPage();n.on('pageerror',error=>report.errors.push(error.message));await n.goto(base+'/#home');await n.waitForFunction(count=>GlobalVoice.voices().length===count,expected.length);
    for(const voice of expected){await n.locator('#globalVoiceSelect').selectOption(voice.id);await n.locator('#homeVoiceTest').click();assert.equal(await n.evaluate(()=>__calls.at(-1).voice),voice.id);}
    await n.locator('#globalRateSelect').selectOption('0.65');await n.reload();await n.waitForFunction(count=>GlobalVoice.voices().length===count,expected.length);assert.equal(await n.locator('#globalVoiceSelect').inputValue(),expected.at(-1).id);
    await mode(n,'poetry/ts-011');await n.locator('#poetrySpeak').click();assert.equal(await n.evaluate(()=>__calls.at(-1).rate),.65);await n.evaluate(()=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id:__calls.at(-1).id,state:'error'}})));assert.match(await n.locator('#poetrySpeechStatus').textContent(),/在线声音/);assert.equal(await n.locator('#poetryVoiceSettings').isVisible(),false);await native.close();
    if(report.voices.length===online.length)report.checks.push('Every online voice starts real playback in the phone-preview page');
    report.checks.push('All seven speech activities, nine-character repeat and phrase practice use the selected online voice and rate','Playback completes naturally and cancellation releases the shared player','A network failure retains the chosen voice, clears busy state and allows local speech','All online choices reach the simulated native bridge, survive reload and show the correct network error','Android production protocol MP3 files decode successfully');
    assert.deepEqual(report.errors,[]);report.completed=true;
  }finally{await browser.close();fs.writeFileSync(path.join(out,'preview.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({completed:report.completed,voices:report.voices.length,activities:report.activities.length,checks:report.checks}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
