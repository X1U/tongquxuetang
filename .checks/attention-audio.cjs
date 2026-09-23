'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'attention-1.20');
const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
const voices=JSON.parse(fs.readFileSync(path.join(root,'content/voices/online-voices.json'))).voices;
const sample=fs.readFileSync(path.join(__dirname,'online-voice-1.16/android-protocol-zh-CN-XiaoxiaoNeural.mp3'));
const requests=[],report={completed:false,checks:[],errors:[],fixture:'Local synthesis responses use a previously verified MP3; browser decoding/playback and production cache integration are real. This does not test new sentence pronunciation.'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/speech/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({available:true,voices}));return;}
  if(url.pathname==='/api/speech'){
    requests.push({text:url.searchParams.get('text'),voice:url.searchParams.get('voice'),rate:Number(url.searchParams.get('rate')),prefetch:req.headers['x-speech-prefetch']==='1'});
    res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':sample.length,'Cache-Control':'no-store'});res.end(sample);return;
  }
  if(url.pathname.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}
  res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);
});
(async()=>{
  fs.mkdirSync(out,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--mute-audio']});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(voice=>{
      localStorage.setItem('tongqu-global-voice-v1',JSON.stringify({voiceId:voice.id,rate:.78}));
      Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});
      window.__playing=[];document.addEventListener('playing',event=>{if(event.target instanceof HTMLAudioElement)window.__playing.push({src:event.target.currentSrc,duration:event.target.duration});},true);
    },voices[0]);
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/#attention');await page.waitForFunction(()=>GlobalVoice.source()==='server');
    async function cached(selector){
      await page.waitForTimeout(700);const before=requests.length;await page.evaluate(()=>window.__playing=[]);await page.locator(selector).click();
      await page.waitForFunction(()=>window.__playing.length>0);const playing=await page.evaluate(()=>window.__playing[0]);
      assert.ok(playing.src.startsWith('blob:')&&playing.duration>0,'Prepared MP3 is decoded and played');
      assert.equal(requests.slice(before).filter(item=>!item.prefetch).length,0,'No foreground synthesis for already prepared text');return playing;
    }
    report.sentencePlayback=await cached('#attentionPlay');assert.equal(await page.locator('#attentionContinue').isDisabled(),true);
    await page.waitForFunction(()=>!document.getElementById('attentionContinue').disabled);await page.locator('#attentionContinue').click();
    report.questionPlayback=await cached('#attentionReadQuestion');await page.locator('#attentionStop').click();assert.equal(await page.locator('.attention-option:enabled').count(),3);
    assert.ok(requests.some(item=>item.prefetch&&item.text.includes('第一项，')&&item.voice===voices[0].id&&item.rate===.78));
    await context.setOffline(true);await cached('#attentionReadQuestion');await page.locator('#attentionStop').click();await context.setOffline(false);
    await page.locator('#attentionPlay').click();await page.locator('#backHome').click();
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('audio')].some(audio=>!audio.paused)),false);
    await page.locator('#globalVoiceSelect').selectOption(voices[1].id);await page.locator('#globalRateSelect').selectOption('1.05');await page.locator('[data-open-mode="attention"]').click();
    await cached('#attentionReadQuestion');await page.locator('#attentionStop').click();assert.ok(requests.some(item=>item.prefetch&&item.voice===voices[1].id&&item.rate===1.05&&item.text.includes('第一项，')));
    report.checks.push('Sentence and question/options use prepared MP3 audio; natural sentence completion unlocks answering','Already prepared questions play while offline; stopping or going home stops playback','Changing global voice and rate prepares a separate matching audio request');
    assert.deepEqual(report.errors,[]);report.completed=true;await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'audio.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({completed:report.completed,checks:report.checks,errors:report.errors}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
