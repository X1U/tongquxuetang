'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'poetry');
const base=process.env.PICTURE_GAME_TEST_URL||'http://127.0.0.1:8765';
const data=JSON.parse(fs.readFileSync(path.join(root,'content/poetry/poems.json'),'utf8'));
const report={completed:false,actualAudio:[],checks:[],errors:[]};
fs.mkdirSync(out,{recursive:true});
async function waitPlaying(page){await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.readyState>=2;},null,{timeout:25000});}
async function wave(url,saveName){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/audio\/wav/);
  const b=Buffer.from(await response.arrayBuffer());assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');
  let samples=null,byteRate=0;
  for(let i=12;i+8<=b.length;){const kind=b.toString('ascii',i,i+4),size=b.readUInt32LE(i+4);if(kind==='fmt ')byteRate=b.readUInt32LE(i+16);if(kind==='data')samples=b.subarray(i+8,i+8+size);i+=8+size+(size%2);}
  assert.ok(samples&&samples.length>10000);let peak=0,energy=0;
  for(let i=0;i+1<samples.length;i+=2){const value=samples.readInt16LE(i);peak=Math.max(peak,Math.abs(value));energy+=value*value;}
  const rms=Math.sqrt(energy/(samples.length/2));assert.ok(peak>100&&rms>20,'The Chinese speech waveform must not be silence');
  if(saveName)fs.writeFileSync(path.join(out,saveName),b);
  return {bytes:b.length,duration:samples.length/byteRate,peak,rms};
}
(async()=>{
  assert.equal((await (await fetch(base+'/api/speech/status')).json()).available,true);
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    await context.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:undefined,configurable:true});});
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(base+'/#home');await page.locator('#homeVoiceTest').tap();await waitPlaying(page);
    const greetingURL=await page.locator('audio:not(#listeningMedia)').evaluate(a=>a.currentSrc);assert.match(new URL(greetingURL).searchParams.get('text'),/欢迎来到童趣学堂/);report.actualAudio.push({kind:'renamed home greeting',...await wave(greetingURL,'tongqu-greeting-verified.wav')});
    await page.goto(base+'/#poetry/ts-011');await page.locator('#poetrySpeak').tap();await waitPlaying(page);
    const shortURL=await page.locator('audio:not(#listeningMedia)').evaluate(a=>a.currentSrc);assert.match(new URL(shortURL).searchParams.get('text'),/静夜思。李白。床前明月光/);
    report.actualAudio.push({poem:'静夜思',...await wave(shortURL,'jingyesi-verified.wav')});
    await page.locator('#poetryStop').tap();assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null);
    await page.locator('#poetryExplainTab').tap();
    await page.locator('[data-poetry-study="notes"]').tap();
    await page.locator('[data-poetry-word="0"]').scrollIntoViewIfNeeded();
    await page.locator('[data-poetry-word="0"]').tap();await waitPlaying(page);
    const wordURL=await page.locator('audio:not(#listeningMedia)').evaluate(a=>a.currentSrc);assert.ok(new URL(wordURL).searchParams.get('text').includes(data.poems.find(p=>p.number===11).notes[0].word));report.actualAudio.push({kind:'word explanation',...await wave(wordURL)});
    await page.locator('#poetryStop').tap();
    for(const section of ['translation','notes','background','analysis','appreciation']){
      await page.locator(`[data-poetry-study="${section}"]`).tap();await page.locator('#poetrySpeak').tap();await waitPlaying(page);
      const source=await page.locator('audio:not(#listeningMedia)').evaluate(a=>a.currentSrc),poem=data.poems.find(p=>p.number===11);
      const expected=section==='notes'?poem.notes.map(n=>n.word+'。'+n.meaning).join(''):[poem.study[section]].flat().filter(Boolean).join('。');
      assert.ok(expected.startsWith(new URL(source).searchParams.get('text')),'Section audio matches '+section);
      report.actualAudio.push({kind:section,...await wave(source)});
      await page.locator(`[data-poetry-study="${section==='translation'?'notes':'translation'}"]`).tap();assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null);assert.equal(await page.locator('#poetryStop').isVisible(),false);
    }
    report.checks.push('All five study sections produce real non-silent Chinese audio; switching sections cancels the previous sound.');
    await page.goto(base+'/#poetry/ts-250');await page.locator('#poetrySpeak').tap();
    const parts=[];let previous='';
    for(let i=0;i<12;i++){
      if(!await page.locator('#poetryStop').isVisible())break;
      await page.waitForFunction(previous=>{const a=document.querySelector('audio');return a&&a.getAttribute('src')!==previous&&!a.paused&&a.readyState>=2;},previous,{timeout:25000});
      const source=await page.locator('audio:not(#listeningMedia)').getAttribute('src');previous=source;
      const text=new URL(source,base).searchParams.get('text');assert.ok(text.length<=220&&text.length>0);parts.push(text);
      report.actualAudio.push({poem:'长恨歌',part:i+1,characters:text.length,...await wave(new URL(source,base).href)});
      // Every segment is loaded and begins real playback. Dispatch completion to
      // exercise the next segment without waiting through the entire long poem.
      await page.locator('audio:not(#listeningMedia)').evaluate(a=>a.dispatchEvent(new Event('ended')));
    }
    const long=data.poems.find(p=>p.number===250);assert.equal(parts.join(''),long.title+'。'+long.author+'。'+long.verses.map(v=>v.text).join(''));assert.ok(parts.length>=4);assert.equal(await page.locator('#poetryStop').isVisible(),false);
    report.checks.push('Real HTTP WAV playback works with both browser speech APIs removed. All long-poem segments load and start playback; completion events are accelerated in the test.');
    await page.goto(base+'/#poetry/ts-011');await page.locator('[data-poetry-verse="0"]').tap();await page.locator('[data-poetry-verse="1"]').tap();await waitPlaying(page);assert.equal(new URL(await page.locator('audio:not(#listeningMedia)').evaluate(a=>a.currentSrc)).searchParams.get('text'),'疑是地上霜。');
    await page.locator('#poetryBackCatalog').tap();assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null);
    await page.locator('#poetryResume').tap();await page.locator('#poetrySpeak').tap();await waitPlaying(page);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null);assert.equal(await page.locator('#poetryStop').isVisible(),false);
    report.checks.push('Second tap supersedes old verse; directory return and hidden-page event cancel playback.');
    await context.close();
    const failed=await browser.newContext();const failPage=await failed.newPage();failPage.on('pageerror',e=>report.errors.push(e.message));await failPage.route('**/api/speech?*',route=>route.fulfill({status:503,body:'Speech unavailable'}));await failPage.goto(base+'/#poetry/ts-011');await failPage.locator('#poetrySpeak').click();await failPage.waitForFunction(()=>document.querySelector('#poetrySpeechStatus').textContent.includes('暂时没播出来'));assert.equal(await failPage.locator('#poetryStop').isVisible(),false);await failed.close();report.checks.push('Audio-service error ends the busy state and offers a retry message.');
    const fallback=await browser.newContext();
    await fallback.addInitScript(()=>{
      window.__fallback=[];window.SpeechSynthesisUtterance=function(text){this.text=text;};
      Object.defineProperty(window,'speechSynthesis',{value:{
        getVoices(){return [{lang:'zh-CN'}];},cancel(){},resume(){},
        speak(u){window.__fallback.push({text:u.text,rate:u.rate});setTimeout(()=>{if(u.onstart)u.onstart();if(u.onend)u.onend();},0);}
      }});
    });
    const f=await fallback.newPage();f.on('pageerror',e=>report.errors.push(e.message));await f.goto(pathToFileURL(path.join(root,'app/src/main/assets/index.html')).href+'#home');await f.locator('#globalRateSelect').selectOption('0.65');await f.evaluate(()=>location.hash='poetry/ts-011');await f.locator('#poetrySpeak').click();await f.waitForFunction(()=>window.__fallback.length>0);assert.equal(await f.evaluate(()=>window.__fallback[0].rate),.65);assert.match(await f.evaluate(()=>window.__fallback[0].text),/静夜思/);await fallback.close();report.checks.push('Direct-file browser speech fallback uses the global speed setting (simulated browser voice).');
    assert.deepEqual(report.errors,[]);report.completed=true;console.log(JSON.stringify({completed:true,waveforms:report.actualAudio.length,longPoemSegments:parts.length,checks:report.checks}));
  }finally{await browser.close();fs.writeFileSync(path.join(out,'audio-report.json'),JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
