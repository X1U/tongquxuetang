'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {LocalSpeech}=require('../server/speech-service.cjs');
const out=path.join(__dirname,'global-voice-1.15');fs.mkdirSync(out,{recursive:true});
const report={completed:false,voices:[],samples:[],checks:[]};
function wave(data){
  assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WAVE');
  let format,samples;
  for(let at=12;at+8<=data.length;){
    const id=data.toString('ascii',at,at+4),length=data.readUInt32LE(at+4);assert.ok(at+8+length<=data.length);
    if(id==='fmt ')format={encoding:data.readUInt16LE(at+8),channels:data.readUInt16LE(at+10),sampleRate:data.readUInt32LE(at+12),bits:data.readUInt16LE(at+22)};
    if(id==='data')samples=data.subarray(at+8,at+8+length);
    at+=8+length+length%2;
  }
  assert.ok(format&&samples);assert.equal(format.encoding,1);assert.equal(format.bits,16);
  let peak=0,energy=0;for(let i=0;i<samples.length;i+=2){const sample=samples.readInt16LE(i);peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}
  const rms=Math.sqrt(energy/(samples.length/2)),duration=samples.length/(format.sampleRate*format.channels*2);
  assert.ok(peak>100&&rms>20&&duration>1,'Speech must contain a real, non-silent waveform');
  return {...format,duration,peak,rms,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
}
(async()=>{
  const service=new LocalSpeech(path.resolve(__dirname,'..'));
  try{
    const status=await service.status();assert.equal(status.available,true,'Windows speech must be available');
    report.voices=status.voices;assert.ok(report.voices.length>=2,'This computer has multiple installed Chinese voices');
    assert.ok(report.voices.some(v=>v.engine==='onecore'),'Current Windows Chinese voices must be exposed');
    const sentence='你好，欢迎来到童趣学堂。我们一起看图，数数，读古诗。';
    for(const [index,voice] of report.voices.entries()){
      const rows=[];
      for(const rate of [.65,.78,.9,1.05,1.2]){
        const data=await service.audio(sentence,rate,voice.id),entry={voice:voice.name,rate,...wave(data)};
        report.samples.push(entry);rows.push(entry);
        if(rate===.9){fs.writeFileSync(path.join(out,'voice-'+index+'.wav'),data);assert.deepEqual(await service.audio(sentence,rate,voice.id),data,'Cached audio preserves the voice');}
      }
      for(let i=1;i<rows.length;i++)assert.ok(rows[i].duration<rows[i-1].duration,voice.name+' has five distinct rates');
      console.log(JSON.stringify({voice:voice.name,durations:rows.map(r=>Number(r.duration.toFixed(2)))}));
    }
    await assert.rejects(service.audio(sentence,.9,'missing-voice'),e=>e.code==='INVALID_VOICE'&&e.status===400);
    await assert.rejects(service.audio(sentence,2),e=>e.code==='INVALID_RATE');
    report.checks.push('Every listed voice produces non-silent speech at all five distinct speeds','Voice-specific audio cache remains stable','Unknown voices and invalid rates are rejected');
    report.completed=true;
  }finally{service.close();fs.writeFileSync(path.join(out,'audio.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({completed:report.completed,voices:report.voices.length,samples:report.samples.length}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
