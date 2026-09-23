'use strict';
const fs=require('node:fs'),path=require('node:path');
const {EdgeTTS}=require('../tools/online-speech/node_modules/node-edge-tts');
const out=path.join(__dirname,'online-voice-1.16');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const file=path.join(out,'first-online-sample.mp3');
  const speech=new EdgeTTS({voice:'zh-CN-XiaoxiaoNeural',lang:'zh-CN',rate:'-10%',timeout:20000});
  await speech.ttsPromise('你好，欢迎来到童趣学堂。我们一起看图，数数，读古诗。',file);
  const bytes=fs.statSync(file).size;if(bytes<1000)throw new Error('No usable audio received');
  console.log(JSON.stringify({voice:'zh-CN-XiaoxiaoNeural',bytes,file}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
