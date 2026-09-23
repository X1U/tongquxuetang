'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {SpeechAudioCache}=require('../server/speech-audio-cache.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'speech-latency-1.18'),classes=path.join(out,'java-classes');
const java='C:/Users/admin/.jdks/ms-17.0.15/bin';
fs.mkdirSync(classes,{recursive:true});
function run(exe,args){const result=spawnSync(path.join(java,exe+'.exe'),args,{cwd:root,encoding:'utf8',timeout:30000,windowsHide:true});if(result.status!==0)throw new Error(result.stderr||result.error?.message||'Java check failed');process.stdout.write(result.stdout||'');}
run('javac',['-encoding','UTF-8','-d',classes,...['OnlineSpeechProtocol.java','SpeechAudioCache.java','SpeechAudioRepository.java'].map(name=>path.join(root,'app/src/main/java/com/picturecard/learning',name)),path.join(__dirname,'SpeechAudioCheck.java')]);
run('java',['-cp',classes,'com.picturecard.learning.SpeechAudioCheck',out]);
(async()=>{const report=JSON.parse(fs.readFileSync(path.join(out,'java.json')));const bytes=await new SpeechAudioCache(path.join(out,'java-cache-exchange')).get(report.exchangeKey);assert.deepEqual(bytes,Buffer.alloc(1600,37),'Java and Node interpret persistent audio files consistently');report.crossRuntimeCacheVerified=true;fs.writeFileSync(path.join(out,'java.json'),JSON.stringify(report,null,2));console.log('Cross-runtime cache format verified');})().catch(error=>{console.error(error);process.exitCode=1;});
