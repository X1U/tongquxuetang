'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const WebSocket=require('../tools/online-speech/node_modules/ws');
const {SpeechAudioCache}=require('./speech-audio-cache.cjs');
// Protocol constants from node-edge-tts 1.2.10 (MIT). The public Edge client
// identifier is not a user account or a private cloud API credential.
const {TRUSTED_CLIENT_TOKEN,CHROMIUM_FULL_VERSION,generateSecMsGecToken}=require('../tools/online-speech/node_modules/node-edge-tts/dist/drm');
const BASE='https://speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'+CHROMIUM_FULL_VERSION.split('.')[0]+'.0.0.0 Safari/537.36 Edg/'+CHROMIUM_FULL_VERSION.split('.')[0]+'.0.0.0';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function failure(code='ONLINE_SPEECH_UNAVAILABLE',status=503){return Object.assign(new Error('在线声音暂时无法播放，请检查网络或切换本机声音。'),{code,status});}
function normalizeVoices(rows,known=[]){
  if(!Array.isArray(rows))throw failure();
  const existing=new Map(known.map(v=>[v.shortName,v])),seen=new Set();
  const result=rows.filter(row=>/^(zh|cmn|yue)(-[a-z0-9]+)*Neural$/i.test(row.ShortName||'')&&/^(zh|cmn|yue)(-|$)/i.test(row.Locale||'')).map(row=>{
    const old=existing.get(row.ShortName),lang=String(row.Locale),group=old?.group||(/^zh-CN$/i.test(lang)?'普通话':/^zh-TW$/i.test(lang)?'台湾普通话':/^zh-HK$|^yue/i.test(lang)?'粤语':lang);
    return {id:'online:'+row.ShortName,shortName:row.ShortName,name:old?.name||row.ShortName.split('-').at(-1).replace(/Neural$/,''),lang,gender:row.Gender==='Female'?'女声':row.Gender==='Male'?'男声':'',group,local:false};
  }).filter(v=>!seen.has(v.id)&&seen.add(v.id));
  if(!result.length||result.length>300)throw failure();
  return result.sort((a,b)=>{const ai=known.findIndex(v=>v.id===a.id),bi=known.findIndex(v=>v.id===b.id);return (ai<0?999:ai)-(bi<0?999:bi)||a.id.localeCompare(b.id);});
}
function audioPacket(data){
  if(data.length<2)throw failure('INVALID_AUDIO');
  const length=data.readUInt16BE(0);if(length+2>data.length)throw failure('INVALID_AUDIO');
  const headers=data.toString('utf8',2,length+2);
  if(!/(?:^|\r\n)Path:audio(?:\r\n|$)/.test(headers))return null;
  return data.subarray(length+2);
}
class OnlineSpeech {
  constructor(project,{cacheDirectory=path.join(project,'.voice-cache/online-v1')}={}){
    this.voices=JSON.parse(fs.readFileSync(path.join(project,'server/online-voices.json'),'utf8')).voices;
    this.cache=new Map();this.cacheBytes=0;this.pending=new Map();this.queue=[];this.active=0;this.sockets=new Set();this.closed=false;this.lastRefresh=0;this.lastAttempt=0;this.refreshing=null;
    this.disk=new SpeechAudioCache(cacheDirectory);
  }
  async refresh(){
    if(this.refreshing)return this.refreshing;
    if(this.closed||Date.now()-this.lastRefresh<86400000||Date.now()-this.lastAttempt<60000)return this.voices;
    this.lastAttempt=Date.now();
    this.refreshing=(async()=>{
      try{
        const response=await fetch(BASE+'/voices/list?trustedclienttoken='+TRUSTED_CLIENT_TOKEN,{headers:{'User-Agent':agent},signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw failure();
        this.voices=normalizeVoices(await response.json(),this.voices);this.lastRefresh=Date.now();
      }catch(_){/* Keep the previously verified catalog while offline. */}
      return this.voices;
    })();
    try{return await this.refreshing;}finally{this.refreshing=null;}
  }
  audio(text,rate,id,{prefetch=false,signal}={}){
    if(this.closed)return Promise.reject(failure());
    if(signal?.aborted)return Promise.reject(failure('SPEECH_CANCELLED',499));
    const voice=this.voices.find(v=>v.id===id);
    if(!voice)return Promise.reject(failure('INVALID_VOICE',400));
    if(typeof text!=='string'||!text.trim()||text.length>800)return Promise.reject(failure('INVALID_TEXT',400));
    if(!Number.isFinite(rate)||rate<.35||rate>1.5)return Promise.reject(failure('INVALID_RATE',400));
    text=text.replace(/[\u0000-\u001f]/g,' ').trim();rate=Math.round(rate*100)/100;
    const key=crypto.createHash('sha256').update('audio-v1\n'+id+'\n'+rate.toFixed(2)+'\n'+text).digest('hex');
    if(this.cache.has(key)){const bytes=this.cache.get(key);this.cache.delete(key);this.cache.set(key,bytes);return Promise.resolve(bytes);}
    if(this.pending.has(key))return this.subscribe(this.pending.get(key),prefetch,signal);
    if(this.pending.size>=12&&!prefetch){const spare=this.queue.find(job=>this.background(job));if(spare)this.cancel(spare);}
    if(this.pending.size>=12)return Promise.reject(failure('SPEECH_BUSY',429));
    const job={key,text,rate,voice,clients:new Set(),controller:new AbortController(),active:false};
    this.pending.set(key,job);this.queue.push(job);return this.subscribe(job,prefetch,signal);
  }
  background(job){return ![...job.clients].some(client=>!client.prefetch);}
  subscribe(job,prefetch,signal){
    return new Promise((resolve,reject)=>{
      const client={prefetch,resolve,reject,signal,abort:null};
      client.abort=()=>{job.clients.delete(client);signal?.removeEventListener('abort',client.abort);reject(failure('SPEECH_CANCELLED',499));if(!job.clients.size)this.cancel(job);};
      job.clients.add(client);signal?.addEventListener('abort',client.abort,{once:true});
      if(signal?.aborted){client.abort();return;}this.pump();
    });
  }
  settle(job,error,bytes){
    if(this.pending.get(job.key)===job)this.pending.delete(job.key);
    for(const client of job.clients){client.signal?.removeEventListener('abort',client.abort);error?client.reject(error):client.resolve(bytes);}job.clients.clear();
  }
  cancel(job){
    this.queue=this.queue.filter(item=>item!==job);this.settle(job,failure('SPEECH_CANCELLED',499));job.controller.abort();this.pump();
  }
  pump(){
    while(!this.closed&&this.active<2&&this.queue.length){
      let index=this.queue.findIndex(job=>!this.background(job));
      if(index<0){if([...this.pending.values()].some(job=>job.active&&this.background(job)))return;index=0;}
      const job=this.queue.splice(index,1)[0];this.active++;job.active=true;
      (async()=>{
        let bytes=await this.disk.get(job.key);
        if(job.controller.signal.aborted)throw failure('SPEECH_CANCELLED',499);
        if(!bytes){bytes=await this.synthesize(job);if(!job.controller.signal.aborted)await this.disk.put(job.key,bytes);}
        if(job.controller.signal.aborted)throw failure('SPEECH_CANCELLED',499);
        return bytes;
      })().then(bytes=>{
        this.cache.set(job.key,bytes);this.cacheBytes+=bytes.length;
        while(this.cacheBytes>16*1024*1024||this.cache.size>160){const oldest=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(oldest).length;this.cache.delete(oldest);}
        this.settle(job,null,bytes);
      },error=>this.settle(job,error)).finally(()=>{this.active--;job.active=false;this.pump();});
    }
  }
  async synthesize(job){
    const deadline=Date.now()+25000;
    for(let attempt=0;attempt<2;attempt++){
      if(this.closed||job.controller.signal.aborted)throw failure('SPEECH_CANCELLED',499);
      try{return await this.connect(job,deadline-Date.now());}
      catch(error){
        if(this.closed||job.controller.signal.aborted||attempt===1||error.code!=='ONLINE_NETWORK_ERROR'||deadline-Date.now()<1500)throw error;
        await new Promise(resolve=>setTimeout(resolve,400));
      }
    }
  }
  connect(job,remaining){
    return new Promise((resolve,reject)=>{
      const url=BASE.replace('https:','wss:')+'/edge/v1?TrustedClientToken='+TRUSTED_CLIENT_TOKEN+'&Sec-MS-GEC='+generateSecMsGecToken()+'&Sec-MS-GEC-Version=1-'+CHROMIUM_FULL_VERSION;
      const socket=new WebSocket(url,{origin:'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',headers:{'User-Agent':agent,'Cache-Control':'no-cache'},handshakeTimeout:12000,maxPayload:8*1024*1024});
      this.sockets.add(socket);let finished=false,size=0;const chunks=[];
      const done=(error,bytes)=>{if(finished)return;finished=true;clearTimeout(timer);job.controller.signal.removeEventListener('abort',abort);this.sockets.delete(socket);if(socket.readyState===WebSocket.OPEN)socket.close();else socket.terminate();error?reject(error):resolve(bytes);};
      const abort=()=>done(failure('SPEECH_CANCELLED',499));
      const timer=setTimeout(()=>done(failure('ONLINE_SPEECH_TIMEOUT')),remaining);
      socket.on('error',()=>done(failure('ONLINE_NETWORK_ERROR')));socket.on('close',()=>{if(!finished)done(failure('ONLINE_NETWORK_ERROR'));});
      job.controller.signal.addEventListener('abort',abort,{once:true});if(job.controller.signal.aborted){abort();return;}
      socket.on('unexpected-response',(_request,response)=>{
        response.resume();done(failure(response.statusCode>=500?'ONLINE_NETWORK_ERROR':'ONLINE_SERVICE_REJECTED'));
      });
      socket.on('open',()=>{
        socket.send('Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'+JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'false'},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}}));
        const percent=Math.round((job.rate-1)*100),rate=(percent>=0?'+':'')+percent+'%';
        const ssml='<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="'+escape(job.voice.lang)+'"><voice name="'+escape(job.voice.shortName)+'"><prosody rate="'+rate+'" pitch="+0Hz" volume="+0%">'+escape(job.text)+'</prosody></voice></speak>';
        socket.send('X-RequestId:'+crypto.randomBytes(16).toString('hex')+'\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n'+ssml);
      });
      socket.on('message',(data,binary)=>{
        if(finished)return;
        try{
          if(binary){const bytes=audioPacket(data);if(bytes){size+=bytes.length;if(size>8*1024*1024)throw failure();chunks.push(bytes);}}
          else if(/(?:^|\r\n)Path:turn.end(?:\r\n|$)/.test(data.toString())){if(size<500)throw failure();done(null,Buffer.concat(chunks));}
        }catch(_){done(failure());}
      });
    });
  }
  close(){this.closed=true;for(const job of [...this.pending.values()])this.cancel(job);this.queue=[];for(const socket of this.sockets)socket.terminate();this.sockets.clear();}
}
module.exports={OnlineSpeech,normalizeVoices,audioPacket};
