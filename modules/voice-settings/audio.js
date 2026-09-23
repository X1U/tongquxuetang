window.GameVoice=(()=>{
  'use strict';
  const remote=/^https?:$/.test(location.protocol),audio=document.createElement('audio');
  audio.preload='auto';audio.hidden=true;audio.setAttribute('playsinline','');audio.setAttribute('aria-hidden','true');document.body.append(audio);
  const contexts=new Map([['home',{texts:['你好，欢迎来到童趣学堂。一起看图，数数，读古诗吧。']}]]),ready=new Map(),loading=new Map();
  let serverAvailable=remote?null:false,active=null,serial=0,prepareTimer=null,desired=[],batch='',nativeBatch='',readyBytes=0;
  const attempted=new Set();
  const normalize=text=>typeof text==='string'?text.replace(/[\u0000-\u001f]/g,' ').trim():'';
  const owner=()=>['sound','train','attention'].includes(document.body.dataset.mode)?'listening':document.body.dataset.mode||'home';
  const rateFor=value=>Math.round(Math.max(.35,Math.min(1.5,Number(value)||window.GlobalVoice?.rate?.()||.9))*100)/100;
  const address=(text,rate,voice)=>'/api/speech?'+new URLSearchParams({text:normalize(text),rate:String(rate),...(voice?{voice}:{})});
  if(remote&&typeof fetch==='function')fetch('/api/speech/status',{cache:'no-store'}).then(response=>response.ok?response.json():{available:false}).then(status=>{serverAvailable=!!status.available;schedulePreparation();}).catch(()=>{serverAvailable=false;});
  function stop(onlyOwner){
    if(onlyOwner&&(!active||active.owner!==onlyOwner))return;
    serial++;if(active)clearTimeout(active.timer);active=null;
    audio.onplaying=null;audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();
  }
  function cancelPreparation(){
    clearTimeout(prepareTimer);prepareTimer=null;desired=[];batch='';nativeBatch='';attempted.clear();
    for(const controller of loading.values())controller.abort();
    try{window.AndroidTts?.cancelPreparation?.();}catch(_){}
  }
  function schedulePreparation(){clearTimeout(prepareTimer);prepareTimer=setTimeout(runPreparation,120);}
  function prepare(texts,options={}){
    const values=[...new Set((Array.isArray(texts)?texts:[texts]).map(normalize).filter(text=>text&&text.length<=800))].slice(0,6);
    const key=options.owner||owner();contexts.set(key,{texts:values,rate:options.rate});
    if(key===owner())schedulePreparation();
  }
  function runPreparation(){
    prepareTimer=null;
    const context=contexts.get(owner()),voice=window.GlobalVoice?.voiceId?.()||'',source=window.GlobalVoice?.source?.();
    if(document.hidden||!context||!voice.startsWith('online:')){cancelPreparation();return;}
    const rate=rateFor(context.rate),signature=JSON.stringify([voice,rate,context.texts]);
    if(source==='android'){
      if(signature!==nativeBatch&&window.AndroidTts?.prepare){try{window.AndroidTts.prepare(JSON.stringify(context.texts),rate,voice);nativeBatch=signature;}catch(_){} }
      return;
    }
    if(source!=='server'||!remote||serverAvailable===false||typeof AbortController!=='function')return;
    if(batch!==signature){attempted.clear();batch=signature;}
    desired=context.texts.map(text=>address(text,rate,voice));
    for(const [url,controller] of loading)if(!desired.includes(url))controller.abort();
    pumpPreparation();
  }
  function pumpPreparation(){
    if(document.hidden||loading.size||!desired.length)return;
    const url=desired.find(value=>!ready.has(value)&&!attempted.has(value));if(!url)return;
    const controller=new AbortController();loading.set(url,controller);attempted.add(url);
    const timer=setTimeout(()=>controller.abort(),30000);
    fetch(url,{signal:controller.signal,headers:{'X-Speech-Prefetch':'1'},cache:'force-cache'}).then(async response=>{
      if(!response.ok||!(response.headers.get('content-type')||'').startsWith('audio/'))throw new Error('Audio not ready');
      const blob=await response.blob();if(controller.signal.aborted||blob.size<500||blob.size>8*1024*1024)return;
      const entry={url:URL.createObjectURL(blob),bytes:blob.size};ready.set(url,entry);readyBytes+=entry.bytes;
      for(const [key,item] of ready){
        if(readyBytes<=16*1024*1024&&ready.size<=60)break;
        if(item.url===audio.src)continue;URL.revokeObjectURL(item.url);ready.delete(key);readyBytes-=item.bytes;
      }
    }).catch(error=>{
      // A failed speculative request stays silent. A later tap can always retry.
      if(error.name!=='AbortError')for(const value of desired)attempted.add(value);
    }).finally(()=>{clearTimeout(timer);if(loading.get(url)===controller)loading.delete(url);pumpPreparation();});
  }
  function speak(text,options={}){
    if(!remote||serverAvailable===false)return false;
    stop();const request={...options,owner:options.owner||'global',token:serial,started:false};active=request;
    const current=()=>active===request&&request.token===serial;
    const fail=error=>{
      if(!current())return;
      const blocked=error&&error.name==='NotAllowedError';stop();
      options.onerror?.({code:blocked?'PLAYBACK_BLOCKED':'AUDIO_UNAVAILABLE',message:blocked?'请再点一次小喇叭，播放声音。':window.GlobalVoice?.voice?.()?.id.startsWith('online:')?'在线声音暂时无法播放，请检查网络或切换本机声音。':'语音暂时没播出来，请确认电脑预览在运行，再点小喇叭。'});
    };
    audio.onplaying=()=>{if(!current()||request.started)return;request.started=true;clearTimeout(request.timer);options.onstart?.();};
    audio.onended=()=>{if(!current())return;clearTimeout(request.timer);active=null;options.onend?.();};
    audio.onerror=()=>fail();
    const rate=rateFor(options.rate),voice=window.GlobalVoice?.source?.()==='server'?window.GlobalVoice.voiceId():'',url=address(text,rate,voice),cached=ready.get(url);
    if(cached){ready.delete(url);ready.set(url,cached);}
    audio.src=cached?cached.url:url;
    request.timer=setTimeout(()=>fail(),voice.startsWith('online:')?40000:18000);
    // Keep play() inside the tap handler for mobile browser playback permission.
    try{const playing=audio.play();if(playing?.catch)playing.catch(fail);}catch(error){fail(error);}
    return true;
  }
  window.addEventListener('globalvoicesready',event=>{if(remote&&event.detail.source==='server')serverAvailable=true;schedulePreparation();});
  window.addEventListener('globalvoicestop',()=>{stop();cancelPreparation();});
  window.addEventListener('globalvoicechange',schedulePreparation);
  window.addEventListener('learningmodechange',()=>{stop();cancelPreparation();schedulePreparation();});
  window.addEventListener('pagehide',()=>{stop();cancelPreparation();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();cancelPreparation();}else schedulePreparation();});
  return Object.freeze({speak,stop,prepare,cancelPreparation,canPlay:()=>remote&&serverAvailable!==false});
})();
