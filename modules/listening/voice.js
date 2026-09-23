/* One cancellable player for lesson recordings and Chinese speech. */
window.ListeningAudio=(()=>{
  'use strict';
  const media=document.createElement('audio');
  media.id='listeningMedia';media.preload='none';media.hidden=true;media.setAttribute('playsinline','');media.setAttribute('aria-hidden','true');media.volume=.75;document.body.append(media);
  let serial=0,job=null,utterance=null;
  function stop(notify=true){
    const old=job;serial++;job=null;
    if(old)clearTimeout(old.timer);
    media.onplaying=null;media.onended=null;media.onerror=null;media.pause();media.removeAttribute('src');media.load();
    window.GameVoice?.stop('listening');
    if(old?.native){try{window.AndroidTts.stop();}catch(_){}}
    if(utterance){utterance.onend=null;utterance.onerror=null;utterance.onstart=null;try{window.speechSynthesis.cancel();}catch(_){}utterance=null;}
    if(notify&&old)old.callbacks.oncancel?.();
  }
  function play(parts,callbacks={}){
    stop();
    if(!Array.isArray(parts)||!parts.length)return false;
    const current={token:serial,parts,index:0,callbacks,native:false,timer:null};job=current;
    const alive=()=>job===current&&serial===current.token;
    function fail(error){
      if(!alive())return;
      const blocked=error?.name==='NotAllowedError';stop(false);
      callbacks.onerror?.(blocked?'请再点一次播放按钮。':window.GlobalVoice?.voice?.()?.id.startsWith('online:')?'在线声音暂时无法播放，请检查网络或回首页切换本机声音；也可以请家长读题。':'声音暂时没播出来，请重试；也可以请家长读题。');
    }
    function begin(){
      if(!alive())return;
      clearTimeout(current.timer);current.timer=setTimeout(()=>fail(),60000);
      callbacks.onstart?.(current.index);
    }
    function ended(){
      if(!alive())return;
      clearTimeout(current.timer);utterance=null;current.native=false;current.index++;
      if(current.index===parts.length){job=null;media.onplaying=null;media.onended=null;media.onerror=null;callbacks.onend?.();return;}
      next();
    }
    function next(){
      if(!alive())return;
      current.started=false;callbacks.onpart?.(current.index);
      current.timer=setTimeout(()=>fail(),window.GlobalVoice?.voiceId?.().startsWith('online:')?40000:20000);
      const part=parts[current.index];
      window.GameVoice?.prepare?.(parts.slice(current.index,current.index+3).map(item=>typeof item==='string'?item:item.audio?'':item.text),{owner:'listening',rate:callbacks.rate});
      if(part.audio){
        media.onplaying=()=>{if(!alive()||current.started)return;current.started=true;begin();};
        media.onended=ended;media.onerror=fail;media.playbackRate=1;media.src=part.audio;
        try{const pending=media.play();if(pending?.catch)pending.catch(fail);}catch(error){fail(error);}return;
      }
      const text=typeof part==='string'?part:part.text,rate=callbacks.rate||window.GlobalVoice?.rate?.()||.9;
      if(window.AndroidTts?.speakWithId){
        current.native=true;current.nativeId='listening-'+current.token+'-'+current.index;current.begin=begin;current.ended=ended;current.fail=fail;
        try{window.AndroidTts.speakWithId(text,rate,current.nativeId);}catch(error){fail(error);}return;
      }
      if(window.GameVoice?.speak(text,{owner:'listening',rate,onstart:begin,onend:ended,onerror:fail}))return;
      if(window.speechSynthesis&&typeof window.SpeechSynthesisUtterance==='function'){
        try{
          utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=rate;
          const voice=window.GlobalVoice?.pickBrowserVoice?.()||window.speechSynthesis.getVoices().find(item=>/^zh([-_]|$)|cmn/i.test(item.lang));if(voice)utterance.voice=voice;
          utterance.onstart=begin;utterance.onend=ended;utterance.onerror=fail;
          window.speechSynthesis.resume();window.speechSynthesis.speak(utterance);return;
        }catch(error){fail(error);return;}
      }
      fail();
    }
    next();return true;
  }
  window.addEventListener('androidtts',event=>{
    const detail=event.detail||{},current=job;
    if(!current?.native||detail.id!==current.nativeId)return;
    if(detail.state==='start')current.begin();
    else if(detail.state==='end')current.ended();
    else if(detail.state==='error')current.fail();
    else if(detail.state==='cancel')stop();
  });
  window.addEventListener('learningmodechange',()=>stop());
  window.addEventListener('globalvoicestop',()=>stop());
  window.addEventListener('pagehide',()=>stop());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  return Object.freeze({play,stop});
})();
