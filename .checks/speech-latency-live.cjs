'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {OnlineSpeech}=require('../server/online-speech.cjs'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'speech-latency-1.18'),classes=path.join(out,'java-classes');
const java='C:/Users/admin/.jdks/ms-17.0.15/bin',cache='C:/Users/admin/.gradle/caches/modules-2/files-2.1';
function jar(group,name,version){const dir=path.join(cache,group,name,version);for(const hash of fs.readdirSync(dir)){const file=path.join(dir,hash,name+'-'+version+'.jar');if(fs.existsSync(file))return file;}throw Error('Required JVM library missing: '+name);}
function run(exe,args){const child=spawnSync(path.join(java,exe+'.exe'),args,{cwd:root,encoding:'utf8',timeout:55000,windowsHide:true});if(child.status!==0){if(exe==='javac')process.stderr.write(child.stderr);throw Error('Java '+exe+' verification failed');}process.stdout.write(child.stdout||'');}
(async()=>{
  fs.mkdirSync(classes,{recursive:true});const directory=fs.mkdtempSync(path.join(out,'live-server-'));
  let speech=new OnlineSpeech(root,{cacheDirectory:directory}),bytes;const report={completed:false};
  try{const start=performance.now();bytes=await speech.audio('小朋友，我们一起看图，数数，读古诗吧。',.9,'online:zh-CN-XiaoxiaoNeural');report.coldMilliseconds=performance.now()-start;}
  finally{speech.close();}
  speech=new OnlineSpeech(root,{cacheDirectory:directory});speech.synthesize=async()=>{throw Error('Network disabled during cache verification');};
  try{const start=performance.now(),cached=await speech.audio('小朋友，我们一起看图，数数，读古诗吧。',.9,'online:zh-CN-XiaoxiaoNeural');report.restartCacheMilliseconds=performance.now()-start;assert.ok(cached.equals(bytes));}
  finally{speech.close();}
  report.bytes=bytes.length;report.networkDisabledForRestart=true;fs.writeFileSync(path.join(out,'live-server.mp3'),bytes);
  console.log(JSON.stringify({server:report}));
  const cp=[jar('com.squareup.okhttp3','okhttp','4.12.0'),jar('com.squareup.okio','okio-jvm','3.6.0'),jar('org.jetbrains.kotlin','kotlin-stdlib','1.9.10')].join(path.delimiter);
  run('javac',['-encoding','UTF-8','-cp',cp,'-d',classes,...['OnlineSpeechProtocol.java','SpeechAudioCache.java','SpeechAudioRepository.java','OnlineSpeechTransport.java'].map(name=>path.join(root,'app/src/main/java/com/picturecard/learning',name)),path.join(__dirname,'SpeechTransportCheck.java')]);
  run('java',['-cp',classes+path.delimiter+cp,'com.picturecard.learning.SpeechTransportCheck',out]);
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();report.decoded=[];
    for(const file of ['live-server.mp3','live-java.mp3']){
      const decoded=await page.evaluate(async base64=>{const context=new AudioContext(),raw=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),audio=await context.decodeAudioData(raw.buffer),samples=audio.getChannelData(0);let energy=0,peak=0;for(const value of samples){energy+=value*value;peak=Math.max(peak,Math.abs(value));}await context.close();return {seconds:audio.duration,rms:Math.sqrt(energy/samples.length),peak};},fs.readFileSync(path.join(out,file)).toString('base64'));
      assert.ok(decoded.seconds>1&&decoded.rms>.001&&decoded.peak>.01,'Live audio must decode and contain sound');report.decoded.push({file,...decoded});
    }
  }finally{await browser.close();}
  report.completed=true;report.measurementScope='Host-side synthesis and persistent-cache reads; excludes phone player startup and touch latency';
  fs.writeFileSync(path.join(out,'live-server.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(JSON.stringify({completed:false,type:error.name,code:error.code,message:error.code?'Online speech verification did not complete':error.message}));process.exitCode=1;});
