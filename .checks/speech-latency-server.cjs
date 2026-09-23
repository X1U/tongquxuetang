'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {OnlineSpeech}=require('../server/online-speech.cjs');
const {SpeechAudioCache}=require('../server/speech-audio-cache.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'speech-latency-1.18');
const voice='online:zh-CN-XiaoxiaoNeural',bytes=Buffer.alloc(1600,37),checks=[];
const key=text=>crypto.createHash('sha256').update('audio-v1\n'+voice+'\n0.90\n'+text).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message){const end=Date.now()+4000;while(!predicate()){assert.ok(Date.now()<end,message);await delay(5);}}
function controlled(directory){
  const speech=new OnlineSpeech(root,{cacheDirectory:directory}),started=[],waiting=new Map();
  speech.synthesize=job=>new Promise((resolve,reject)=>{
    started.push(job.text);waiting.set(job.text,()=>{job.controller.signal.removeEventListener('abort',abort);resolve(bytes);});
    const abort=()=>{waiting.delete(job.text);reject(Object.assign(new Error('cancelled'),{code:'SPEECH_CANCELLED'}));};
    job.controller.signal.addEventListener('abort',abort,{once:true});if(job.controller.signal.aborted)abort();
  });
  return {speech,started,release(text){assert.ok(waiting.has(text),'A synthesis is waiting: '+text);waiting.get(text)();waiting.delete(text);}};
}
(async()=>{
  await fs.mkdir(out,{recursive:true});const run=await fs.mkdtemp(path.join(out,'server-'));
  const disk=new SpeechAudioCache(path.join(run,'disk')),a=key('甲'),b=key('乙'),c=key('丙');
  await disk.put(a,bytes);assert.deepEqual(await new SpeechAudioCache(disk.directory).get(a),bytes);
  const damaged=await fs.readFile(disk.file(a));damaged[damaged.length-1]^=1;await fs.writeFile(disk.file(a),damaged);
  assert.equal(await disk.get(a),null);await disk.put(a,bytes);await fs.truncate(disk.file(a),80);assert.equal(await disk.get(a),null);
  assert.throws(()=>disk.file('../outside'));await disk.put(a,Buffer.alloc(20));assert.equal(await disk.get(a),null);
  checks.push('Persistent cache reopens successfully; checksum damage, truncation and undersized audio are rejected');
  const bounded=new SpeechAudioCache(path.join(run,'bounded'),{maxBytes:4000,maxEntries:2});
  await bounded.put(a,bytes);await bounded.put(b,bytes);await fs.utimes(bounded.file(b),new Date(1000),new Date(1000));
  await bounded.get(a);await bounded.put(c,bytes);assert.deepEqual(await bounded.get(a),bytes);assert.equal(await bounded.get(b),null);assert.deepEqual(await bounded.get(c),bytes);
  assert.equal((await fs.readdir(bounded.directory)).filter(name=>name.endsWith('.voice')).length,2);
  checks.push('Byte and entry limits evict the least recently used audio');
  const persistentPath=path.join(run,'persistent');let calls=0;
  let speech=new OnlineSpeech(root,{cacheDirectory:persistentPath});speech.synthesize=async()=>{calls++;return bytes;};
  assert.deepEqual(await speech.audio('重启后继续听。',.9,voice),bytes);await speech.audio('重启后继续听。',.9,voice);assert.equal(calls,1);speech.close();
  speech=new OnlineSpeech(root,{cacheDirectory:persistentPath});speech.synthesize=async()=>{calls++;throw new Error('network unavailable');};
  assert.deepEqual(await speech.audio('重启后继续听。',.9,voice),bytes);assert.equal(calls,1);
  await assert.rejects(speech.audio('重启后继续听。',1.05,voice));await assert.rejects(speech.audio('重启后继续听。',.9,'online:zh-CN-YunxiNeural'));
  await assert.rejects(speech.audio('不同文字。',.9,voice));speech.close();
  checks.push('Restarted service reuses saved audio without synthesis; text, voice and rate have independent cache keys');
  const fixture=controlled(path.join(run,'shared'));
  const prepControl=new AbortController(),prepared=fixture.speech.audio('先准备的题目',.9,voice,{prefetch:true,signal:prepControl.signal});
  await until(()=>fixture.started.length===1,'preparation starts');
  const foreground=fixture.speech.audio('先准备的题目',.9,voice);
  const cancelledPrep=prepared.catch(error=>error.code);prepControl.abort();fixture.release('先准备的题目');
  assert.equal(await cancelledPrep,'SPEECH_CANCELLED');assert.deepEqual(await foreground,bytes);assert.equal(fixture.started.length,1);fixture.speech.close();
  checks.push('A tap shares in-flight preparation; cancelling preparation does not cancel the foreground listener');
  const priority=controlled(path.join(run,'priority')),controllers=[new AbortController(),new AbortController()];
  const first=priority.speech.audio('准备一',.9,voice,{prefetch:true,signal:controllers[0].signal}).catch(error=>error.code);
  const second=priority.speech.audio('准备二',.9,voice,{prefetch:true,signal:controllers[1].signal}).catch(error=>error.code);
  await until(()=>priority.started.length===1,'first background task starts');await delay(40);assert.deepEqual(priority.started,['准备一']);
  const tapped=priority.speech.audio('用户点击',.9,voice);await until(()=>priority.started.includes('用户点击'),'tap gets the reserved worker');
  assert.ok(!priority.started.includes('准备二'));priority.release('用户点击');assert.deepEqual(await tapped,bytes);
  controllers.forEach(controller=>controller.abort());assert.equal(await first,'SPEECH_CANCELLED');assert.equal(await second,'SPEECH_CANCELLED');
  await until(()=>priority.speech.active===0,'cancelled work releases workers');assert.ok(!priority.started.includes('准备二'));priority.speech.close();
  checks.push('Only one speculative synthesis runs; a tap starts promptly and cancelled queued work never starts');
  const old=controlled(path.join(run,'stale')),stop=new AbortController();
  const stale=old.speech.audio('快速换题',.9,voice,{signal:stop.signal}).catch(error=>error.code);await until(()=>old.started.length===1,'old request starts');stop.abort();
  const replacement=old.speech.audio('快速换题',.9,voice);await until(()=>old.started.length===2,'replacement starts');old.release('快速换题');
  assert.equal(await stale,'SPEECH_CANCELLED');assert.deepEqual(await replacement,bytes);old.speech.close();
  checks.push('A cancelled request cannot resolve or remove its replacement');
  const unavailable=path.join(run,'not-a-directory');await fs.writeFile(unavailable,'fixture');
  speech=new OnlineSpeech(root,{cacheDirectory:unavailable});speech.synthesize=async()=>bytes;
  assert.deepEqual(await speech.audio('存储不可用仍能朗读',.9,voice),bytes);speech.close();
  checks.push('Cache write failures do not block playback');
  for(const [code,expected] of [['ONLINE_NETWORK_ERROR',2],['ONLINE_SERVICE_REJECTED',1],['ONLINE_SPEECH_TIMEOUT',1]]){
    speech=new OnlineSpeech(root,{cacheDirectory:path.join(run,code)});let attempts=0;
    speech.connect=async()=>{attempts++;throw Object.assign(new Error(code),{code,status:503});};
    await assert.rejects(speech.audio('连接失败',.9,voice),{code});assert.equal(attempts,expected);speech.close();
  }
  checks.push('Transport retries once for transient failures and does not loop on explicit rejection or timeout');
  const report={completed:true,checks,runDirectory:run};await fs.writeFile(path.join(out,'server.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
