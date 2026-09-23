'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {OnlineSpeech,audioPacket}=require('../server/online-speech.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'online-voice-1.16');fs.mkdirSync(out,{recursive:true});
const report={completed:false,voices:[],samples:[],checks:[]};
(async()=>{
  const speech=new OnlineSpeech(root),browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    await speech.refresh();assert.ok(speech.lastRefresh>0,'The live service catalog must be fetched, not only the bundled fallback');report.voices=speech.voices;
    const bundled=JSON.parse(fs.readFileSync(path.join(root,'content/voices/online-voices.json'),'utf8')).voices;assert.deepEqual(speech.voices.map(v=>v.id).sort(),bundled.map(v=>v.id).sort(),'The release includes every currently offered Chinese voice');
    const page=await browser.newPage(),sentence='你好，欢迎来到童趣学堂。我们一起看图，数数，读古诗。';
    async function sample(voice,rate){
      const bytes=await speech.audio(sentence,rate,voice.id),base64=bytes.toString('base64');
      const result=await page.evaluate(async base64=>{const context=new AudioContext(),raw=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const audio=await context.decodeAudioData(raw.buffer),samples=audio.getChannelData(0);let peak=0,energy=0;for(const v of samples){peak=Math.max(peak,Math.abs(v));energy+=v*v;}await context.close();return {duration:audio.duration,peak,rms:Math.sqrt(energy/samples.length),sampleRate:audio.sampleRate};},base64);
      assert.ok(result.duration>1&&result.peak>.01&&result.rms>.001,voice.name+' must produce non-silent, decodable audio');
      const file=voice.shortName+'-'+rate.toFixed(2)+'.mp3';fs.writeFileSync(path.join(out,file),bytes);
      report.samples.push({voice:voice.id,name:voice.name,rate,bytes:bytes.length,...result,file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
      assert.deepEqual(await speech.audio(sentence,rate,voice.id),bytes,'Repeated voice/rate/text requests reuse the correct audio');return result.duration;
    }
    for(const voice of speech.voices){await sample(voice,.9);console.log(voice.name+' '+voice.group+' audio verified');}
    const rateDurations=[];
    for(const rate of [.65,.78,.9,1.05,1.2])rateDurations.push(await sample(speech.voices[0],rate));
    for(let i=1;i<rateDurations.length;i++)assert.ok(rateDurations[i]<rateDurations[i-1],'Five speeds are audibly distinct');
    await assert.rejects(speech.audio(sentence,.9,'online:missing'),e=>e.code==='INVALID_VOICE');await assert.rejects(speech.audio(sentence,NaN,speech.voices[0].id),e=>e.code==='INVALID_RATE');
    assert.throws(()=>audioPacket(Buffer.from([255,255])));
    report.checks.push('All Chinese voices in the live catalog synthesize real non-silent MP3 audio','All five speeds shorten the same sentence progressively','Voice/rate cache and parameter validation pass');report.completed=true;
  }finally{speech.close();await browser.close();fs.writeFileSync(path.join(out,'audio.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({completed:report.completed,voices:report.voices.length,samples:report.samples.length}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
