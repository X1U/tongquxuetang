'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base='http://127.0.0.1:8765',out=path.join(__dirname,'global-voice-1.15');
const report={completed:false,playbacks:[],checks:[],errors:[]};
async function playing(page){await page.waitForFunction(()=>{const a=document.querySelector('audio:not(#listeningMedia)');return a&&!a.paused&&a.readyState>=2&&a.currentTime>0;},null,{timeout:25000});}
(async()=>{
  fs.mkdirSync(out,{recursive:true});const status=await (await fetch(base+'/api/speech/status')).json();assert.equal(status.available,true);assert.ok(status.voices.length>1);
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',error=>report.errors.push(error.message));
    await page.addInitScript(()=>{Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:undefined,configurable:true});});
    await page.goto(base+'/#home');await page.waitForFunction(count=>GlobalVoice.voices().length===count,status.voices.length);
    for(const voice of status.voices){
      await page.locator('#globalVoiceSelect').selectOption(voice.id);
      assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null,'Changing voice cancels the previous audio');assert.equal(await page.locator('#homeVoiceTest').getAttribute('aria-busy'),null);
      await page.locator('#homeVoiceTest').tap();await playing(page);
      const playback=await page.locator('audio:not(#listeningMedia)').evaluate(a=>({src:a.currentSrc,duration:a.duration,time:a.currentTime}));
      assert.equal(new URL(playback.src).searchParams.get('voice'),voice.id);assert.equal(new URL(playback.src).searchParams.get('rate'),'0.9');assert.ok(playback.duration>1);
      report.playbacks.push({voice:voice.name,rate:.9,duration:playback.duration});
    }
    for(const rate of ['0.65','0.78','0.90','1.05','1.20']){
      await page.locator('#globalRateSelect').selectOption(rate);assert.equal(await page.locator('audio:not(#listeningMedia)').getAttribute('src'),null);await page.locator('#homeVoiceTest').tap();await playing(page);
      const playback=await page.locator('audio:not(#listeningMedia)').evaluate(a=>({src:a.currentSrc,duration:a.duration}));assert.equal(Number(new URL(playback.src).searchParams.get('rate')),Number(rate));report.playbacks.push({voice:status.voices.at(-1).name,rate:Number(rate),duration:playback.duration});
    }
    await page.waitForFunction(()=>document.getElementById('homeVoiceStatus').textContent.includes('试播结束'),null,{timeout:25000});assert.equal(await page.locator('#homeVoiceTest').getAttribute('aria-busy'),null);
    await page.locator('[data-open-mode="train"]').tap();await page.locator('#trainPlay').tap();await playing(page);
    const command=await page.locator('audio:not(#listeningMedia)').evaluate(a=>a.currentSrc);assert.equal(new URL(command).searchParams.get('voice'),status.voices.at(-1).id);assert.equal(new URL(command).searchParams.get('rate'),'1.2');await page.waitForFunction(()=>!document.getElementById('trainReview').disabled,null,{timeout:25000});
    await page.locator('#backHome').tap();const chosen=status.voices.find(v=>/Yaoyao/.test(v.name))||status.voices[0];await page.locator('#globalVoiceSelect').selectOption(chosen.id);await page.locator('#globalRateSelect').selectOption('0.90');
    await page.screenshot({path:path.join(out,'home-390x844.png')});await page.setViewportSize({width:320,height:568});await page.screenshot({path:path.join(out,'home-320x568.png')});await page.setViewportSize({width:568,height:320});await page.screenshot({path:path.join(out,'home-568x320.png')});
    report.checks.push('Every real Windows voice loads and plays through the phone-preview HTTP endpoint','All five speeds reach real audio playback; changing settings immediately cancels prior playback','Home playback finishes naturally and clears its playing indicator','A real action command uses the chosen voice and speed, then enables parent review');
    assert.deepEqual(report.errors,[]);report.completed=true;
  }finally{await browser.close();fs.writeFileSync(path.join(out,'preview.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
