window.GlobalVoice=(()=>{
  'use strict';
  const key='tongqu-global-voice-v1',rates=[.65,.78,.9,1.05,1.2],$=id=>document.getElementById(id);
  let saved={voiceId:'',rate:.9},voices=[],source=window.AndroidTts?'android':'browser',refreshing=null;
  try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'){if(typeof value.voiceId==='string')saved.voiceId=value.voiceId;if(rates.includes(Number(value.rate)))saved.rate=Number(value.rate);}}catch(_){}
  const chinese=voice=>/^(zh|cmn|yue)([-_]|$)/i.test(voice.lang||voice.locale||'');
  const browserId=voice=>voice.voiceURI||voice.name;
  const clean=list=>{
    const seen=new Set();return (Array.isArray(list)?list:[]).map(item=>({id:String(item.id||item.name||''),name:String(item.name||item.id||''),lang:String(item.lang||item.locale||''),local:item.local!==false,group:String(item.group||''),gender:String(item.gender||''),raw:item.raw})).filter(item=>item.id&&chinese(item)&&!seen.has(item.id)&&seen.add(item.id));
  };
  function save(){try{localStorage.setItem(key,JSON.stringify(saved));}catch(_){} }
  function stopAll(){window.dispatchEvent(new CustomEvent('globalvoicestop'));window.GameVoice?.stop();window.ListeningAudio?.stop();try{window.AndroidTts?.stop();}catch(_){}try{window.speechSynthesis?.cancel();}catch(_){} }
  function shortName(item){
    if(item.id.startsWith('online:'))return item.name+(item.gender?' · '+item.gender:'');
    const names={huihui:'慧慧',kangkang:'康康',yaoyao:'瑶瑶'};
    const name=item.name.replace(/^Microsoft\s+/i,'').replace(/\b(Huihui|Kangkang|Yaoyao)\b/gi,n=>names[n.toLowerCase()]).replace(/\s+Desktop$/i,'（经典）').replace(/^Google\s+/i,'').trim();
    return (name||item.lang||'中文声音')+(item.local?'':'（联网）');
  }
  function selected(){return voices.find(item=>item.id===saved.voiceId)||null;}
  function applyNative(){if(source==='android'&&window.AndroidTts?.setVoice){try{window.AndroidTts.setVoice(saved.voiceId);}catch(_){}}}
  function render(){
    const select=$('globalVoiceSelect'),rate=$('globalRateSelect');if(!select||!rate)return;
    const current=selected();
    select.replaceChildren(new Option('自动选择',''));
    const groups=new Map();
    for(const item of voices){
      const label=item.id.startsWith('online:')?'联网 · '+(item.group||'中文'):item.local?'本机声音':'系统声音 · 联网';
      if(!groups.has(label)){const group=document.createElement('optgroup');group.label=label;groups.set(label,group);select.append(group);}
      groups.get(label).append(new Option(shortName(item),item.id));
    }
    select.value=current?.id||'';rate.value=saved.rate.toFixed(2);select.disabled=!voices.length;
    select.title=current?.id.startsWith('online:')?current.name+' · '+current.group+' · 需要联网':voices.length?'选择本机或联网的中文发音人':'当前没有检测到可切换的中文发音人';
  }
  function parseNative(){try{return clean(JSON.parse(window.AndroidTts.listVoices()||'[]'));}catch(_){return [];}}
  async function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      let found=[],confirmed=false;
      if(window.AndroidTts){source='android';found=parseNative();confirmed=typeof window.AndroidTts.isReady==='function'?window.AndroidTts.isReady():found.length>0;}
      else if(/^https?:$/.test(location.protocol)&&typeof fetch==='function'){
        const controller=typeof AbortController==='function'?new AbortController():null,timer=controller?setTimeout(()=>controller.abort(),6000):null;
        try{const response=await fetch('/api/speech/status',{cache:'no-store',...(controller?{signal:controller.signal}:{})}),status=response.ok?await response.json():{};if(status.available&&Array.isArray(status.voices)){source='server';found=clean(status.voices);confirmed=true;}else source='browser';}catch(_){source='browser';}finally{clearTimeout(timer);}
      }
      if(source==='browser'&&window.speechSynthesis){found=clean(window.speechSynthesis.getVoices().filter(chinese).map(item=>({id:browserId(item),name:item.name,lang:item.lang,local:item.localService,raw:item})));confirmed=found.length>0;}
      voices=found;
      // Empty voice lists are normal while Android and browser engines start.
      // Only discard a saved choice after a completed enumeration proves it absent.
      if(confirmed&&saved.voiceId&&!selected()){saved.voiceId='';save();}
      applyNative();render();window.dispatchEvent(new CustomEvent('globalvoicesready',{detail:{source,voices:[...voices]}}));return voices;
    })();
    try{return await refreshing;}finally{refreshing=null;}
  }
  function pickBrowserVoice(list=window.speechSynthesis?.getVoices?.()||[]){
    const available=list.filter(chinese),choice=saved.voiceId&&available.find(item=>browserId(item)===saved.voiceId||item.name===saved.voiceId);
    return choice||available.find(item=>/^zh[-_]CN$/i.test(item.lang)&&item.localService)||available.find(item=>/^zh[-_]CN$/i.test(item.lang))||available[0]||null;
  }
  function setStatus(message){const node=$('homeVoiceStatus');if(node)node.textContent=message;}
  $('globalVoiceSelect')?.addEventListener('change',event=>{saved.voiceId=event.target.value;save();stopAll();applyNative();render();setStatus((selected()?.local===false?'已选择联网声音，':'发音人已切换，')+'点右上角“听听声音”试听。');window.dispatchEvent(new CustomEvent('globalvoicechange',{detail:{voiceId:saved.voiceId,rate:saved.rate}}));});
  $('globalRateSelect')?.addEventListener('change',event=>{const rate=Number(event.target.value);saved.rate=rates.includes(rate)?rate:.9;save();stopAll();setStatus('语速已切换，点右上角“听听声音”试听。');window.dispatchEvent(new CustomEvent('globalvoicechange',{detail:{voiceId:saved.voiceId,rate:saved.rate}}));});
  if(window.speechSynthesis){const changed=()=>{if(source==='browser'||!voices.length)refresh();};if(typeof window.speechSynthesis.addEventListener==='function')window.speechSynthesis.addEventListener('voiceschanged',changed);else window.speechSynthesis.onvoiceschanged=changed;}
  window.addEventListener('learningmodechange',event=>{if(event.detail.mode==='home')refresh();});
  render();setTimeout(refresh,0);
  return Object.freeze({rate:()=>saved.rate,voiceId:()=>selected()?.id||'',voice:()=>selected(),voices:()=>[...voices],source:()=>source,pickBrowserVoice,refresh,stopAll});
})();
