'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {OnlineSpeech}=require('../server/online-speech.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'online-voice-1.16');
const failure=code=>Object.assign(new Error(code),{code,status:503});
const voice='online:zh-CN-XiaoxiaoNeural',bytes=Buffer.alloc(1600,1);
(async()=>{
  const report={completed:false,checks:[]};
  const recovered=new OnlineSpeech(root);let calls=0;
  recovered.connect=async()=>{if(++calls===1)throw failure('ONLINE_NETWORK_ERROR');return bytes;};
  const requests=await Promise.all([recovered.audio('短暂断线后重试。',.9,voice),recovered.audio('短暂断线后重试。',.9,voice)]);
  assert.ok(requests.every(result=>result.equals(bytes)));assert.equal(calls,2);
  await recovered.audio('短暂断线后重试。',.9,voice);assert.equal(calls,2);recovered.close();
  report.checks.push('One transport retry recovers; identical requests share work and the completed audio is cached');
  for(const [code,expected] of [['ONLINE_NETWORK_ERROR',2],['ONLINE_SERVICE_REJECTED',1],['ONLINE_SPEECH_TIMEOUT',1]]){
    const failed=new OnlineSpeech(root);let attempts=0;failed.connect=async()=>{attempts++;throw failure(code);};
    await assert.rejects(failed.audio('无法连接。',.9,voice),{code});assert.equal(attempts,expected);failed.close();
  }
  report.checks.push('Persistent transport errors retry only once; explicit service rejections and elapsed deadlines do not loop');
  const stopped=new OnlineSpeech(root);let stoppedCalls=0;
  stopped.connect=async()=>{stoppedCalls++;stopped.close();throw failure('ONLINE_NETWORK_ERROR');};
  await assert.rejects(stopped.audio('停止后不要继续。',.9,voice));assert.equal(stoppedCalls,1);
  report.checks.push('Closing the service rejects pending work and prevents a retry');
  const bounded=new OnlineSpeech(root);let active=0,maxActive=0;
  bounded.connect=async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,15));active--;return bytes;};
  await Promise.all(Array.from({length:6},(_,i)=>bounded.audio('第'+i+'句话。',.9,voice)));assert.equal(maxActive,2);bounded.close();
  report.checks.push('At most two synthesis requests run together');
  report.completed=true;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'recovery.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
