(() => {
  'use strict';
  const $=id=>document.getElementById(id),data=window.TangPoetry,art=window.PoetryArt,paging=window.PoetryPagination;
  const byId=new Map(data.poems.map(poem=>[poem.id,poem]));
  const meterNames={five:'五言',seven:'七言',mixed:'长短句'},genreNames={jue:'绝句',lv:'律诗',gu:'古诗',yuefu:'乐府'};
  const meterOrder=Object.keys(meterNames),genreOrder=Object.keys(genreNames);
  const studyNames={translation:'译文',notes:'注释',background:'背景',analysis:'简析',appreciation:'赏析'};
  const poems=[...data.poems].sort((a,b)=>meterOrder.indexOf(a.meter)-meterOrder.indexOf(b.meter)||genreOrder.indexOf(a.genre)-genreOrder.indexOf(b.genre)||a.number-b.number);
  const key='picture-learning-poetry-v1';let stored={};
  try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))stored=value;}catch(_){}
  let pageSize=Number.isInteger(stored.pageSize)&&stored.pageSize>0?stored.pageSize:12;
  const state={meter:['all',...meterOrder].includes(stored.meter)?stored.meter:'all',genre:['all',...genreOrder].includes(stored.genre)?stored.genre:'all',query:typeof stored.query==='string'?stored.query.slice(0,100):'',page:Number.isInteger(stored.page)&&stored.page>0?stored.page:1,pinyin:stored.pinyin!==false,lastId:byId.has(stored.lastId)?stored.lastId:null,visited:new Set(Array.isArray(stored.visited)?stored.visited.filter(id=>byId.has(id)):[]),reading:stored.reading&&byId.has(stored.reading.id)?stored.reading:{id:null,read:null,explain:null},currentId:null,tab:'read'};
  if(!poems.some(poem=>(state.meter==='all'||poem.meter===state.meter)&&(state.genre==='all'||poem.genre===state.genre)))state.genre='all';
  state.studySection=Object.hasOwn(studyNames,stored.studySection)?stored.studySection:'translation';
  let filtered=[],readingSequence=[],active=false,searchTimer=null,composing=false,layoutFrame=null;
  let searchText=null,cachedQuery=null,cachedMatches=poems,sheetUnits=[],sheetPages=[],sheetPage=0,sheetOrigin=null,readerSaveTimer=null;
  let voiceSerial=0,voiceJob=null,utterance=null,voiceTimer=null;
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizeSearch=text=>String(text).normalize('NFKC').toLowerCase().replace(/[\s，。！？；：、·“”‘’《》（）【】,.!?;:'"()[\]{}]/g,'');
  const icon='<svg class="icon" aria-hidden="true"><use href="#i-sound"/></svg>';
  const ruby=tokens=>tokens.map(([character,sound])=>sound?`<ruby aria-hidden="true"><span>${esc(character)}</span><rt>${esc(sound)}</rt><rp>（${esc(sound)}）</rp></ruby>`:`<span class="poetry-punctuation" aria-hidden="true">${esc(character)}</span>`).join('');
  function save(){try{localStorage.setItem(key,JSON.stringify({meter:state.meter,genre:state.genre,query:state.query,page:state.page,pageSize,pinyin:state.pinyin,lastId:state.lastId,visited:[...state.visited],reading:state.reading,studySection:state.studySection}));}catch(_){} }
  function searchMatches(){
    const query=state.query.trim();if(query===cachedQuery)return cachedMatches;
    const words=query.split(/\s+/).map(normalizeSearch).filter(Boolean);
    if(words.length&&!searchText)searchText=new Map(poems.map(poem=>[poem.id,normalizeSearch([poem.title,poem.alternateTitle||'',poem.author,...poem.verses.map(v=>v.text)].join(' '))]));
    cachedQuery=query;cachedMatches=words.length?poems.filter(poem=>words.every(word=>searchText.get(poem.id).includes(word))):poems;return cachedMatches;
  }
  function matching(){return searchMatches().filter(poem=>(state.meter==='all'||poem.meter===state.meter)&&(state.genre==='all'||poem.genre===state.genre));}
  function setViewport(){const height=Math.round(window.visualViewport?.height||innerHeight);document.documentElement.style.setProperty('--poetry-vh',height+'px');document.documentElement.dataset.poetrySize=height<390?'tiny':height<560?'compact':'regular';}
  function setPageOptions(select,total,current,label=''){const options=Array.from({length:total},(_,i)=>`<option value="${i+1}">${label}${i+1} / ${total} 页</option>`).join('');if(select.dataset.options!==options){select.innerHTML=options;select.dataset.options=options;}select.value=String(current);}
  function renderCatalog(){
    filtered=matching();
    if(!composing&&$('poetrySearch').value!==state.query)$('poetrySearch').value=state.query;
    $('poetryClearSearch').hidden=!$('poetrySearch').value;$('poetryGenre').value=state.genre;
    for(const option of $('poetryGenre').options)option.disabled=option.value!=='all'&&!poems.some(poem=>(state.meter==='all'||poem.meter===state.meter)&&poem.genre===option.value);
    document.querySelectorAll('[data-poetry-meter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.poetryMeter===state.meter)));
    const last=byId.get(state.lastId);$('poetryResume').hidden=!last;if(last)$('poetryResume').setAttribute('aria-label','接着读《'+last.title+'》');
    $('poetryEmpty').hidden=filtered.length>0;$('poetryList').hidden=filtered.length===0;
    const list=$('poetryList'),height=list.clientHeight,width=list.clientWidth;
    if(filtered.length&&height>0){
      const columns=width>=900?3:width>=550?2:1,rowHeight=height<140?64:82,rows=Math.max(1,Math.floor((height+7)/(rowHeight+7))),capacity=columns*rows;
      if(pageSize!==capacity){const first=(state.page-1)*pageSize;pageSize=capacity;state.page=Math.floor(first/pageSize)+1;}
      list.style.setProperty('--poetry-columns',columns);list.style.setProperty('--poetry-rows',rows);
      list.classList.toggle('is-compact',height/rows<73);list.classList.toggle('is-mini',height/rows<52);
    }
    const pages=Math.max(1,Math.ceil(filtered.length/pageSize));state.page=Math.max(1,Math.min(pages,state.page));
    const start=(state.page-1)*pageSize,shown=filtered.slice(start,start+pageSize);
    const scope=state.meter==='all'?(state.genre==='all'?'全部诗词':genreNames[state.genre]):meterNames[state.meter]+(state.genre==='all'?'':genreNames[state.genre]);
    $('poetryResultCount').textContent=`${scope} · ${state.query.trim()?'找到':'共'} ${filtered.length} 篇${shown.length?` · ${start+1}–${start+shown.length}`:''}`;
    list.dataset.total=String(filtered.length);list.dataset.pageSize=String(pageSize);list.dataset.page=String(state.page);
    list.innerHTML=shown.map((poem,index)=>`<button type="button" class="poetry-card" data-poetry-id="${poem.id}" aria-label="读${esc(poem.title)}，${esc(poem.author)}"><span class="poetry-card-index" aria-hidden="true">${String(start+index+1).padStart(3,'0')}</span><span class="poetry-card-copy"><span class="poetry-card-name">${esc(poem.title)}${state.visited.has(poem.id)?'<span class="poetry-read-mark">读过</span>':''}</span><span class="poetry-card-byline">${esc(poem.author)} · ${poem.type}</span><span class="poetry-card-preview">${esc(poem.verses.slice(0,2).map(v=>v.text).join(''))}</span></span></button>`).join('');
    document.querySelectorAll('[data-poetry-page-step]').forEach(button=>button.disabled=Number(button.dataset.poetryPageStep)<0?state.page===1:state.page===pages);
    setPageOptions(document.querySelector('[data-poetry-page-select]'),pages,state.page);save();
  }
  const textUnit=(key,title,text,kind='text')=>({key,title,kind,parts:[...text]});
  function fragmentMarkup(piece){
    const {unit,from,to}=piece,parts=unit.parts.slice(from,to),continued=from>0?'（续）':'';
    const mark=`data-poetry-fragment="${esc(unit.key)}" data-from="${from}" data-to="${to}"`;
    if(unit.kind==='verse')return `<button type="button" class="poetry-verse${unit.parts.filter(t=>t[1]).length>7?' is-long':''}" data-poetry-verse="${unit.index}" ${mark} aria-label="朗读第 ${unit.index+1} 句：${esc(unit.text)}">${ruby(parts)}</button>`;
    if(unit.kind==='title')return `<div class="poetry-title-fragment" ${mark} aria-label="${esc(parts.map(t=>t[0]).join(''))}">${ruby(parts)}</div>`;
    if(unit.kind==='directory')return `<div class="poetry-directory-pair" ${mark}>${unit.entries.map(entry=>`<button type="button" data-poetry-directory="${entry.meter}/${entry.genre}" aria-pressed="${state.meter===entry.meter&&state.genre===entry.genre}"${entry.count?'':' disabled'}>${entry.name}<span>${entry.count} 篇</span></button>`).join('')}</div>`;
    const heading=unit.kind==='note'?`<h2 class="poetry-note-heading"><button type="button" data-poetry-word="${unit.index}" aria-label="听词语解释：${esc(unit.word)}">${ruby(unit.tokens)}${icon}</button>${continued?'<span>续</span>':''}</h2>`:unit.title?`<h2>${esc(unit.title)}${continued}</h2>`:'';
    return `<section class="poetry-text-block${unit.kind==='unavailable'?' is-unavailable':''}" ${mark}>${heading}<p data-poetry-fragment-text${unit.kind==='license'?' class="poetry-license-fragment"':''}>${esc(parts.join(''))}</p></section>`;
  }
  function unitsFor(poem,tab=state.tab){
    if(tab==='read')return poem.verses.map((verse,index)=>({key:'verse-'+index,kind:'verse',parts:verse.tokens,index,text:verse.text}));
    if(state.studySection==='notes')return poem.notes.map((note,index)=>({...textUnit('note-'+index,'',note.meaning,'note'),index,word:note.word,tokens:note.tokens}));
    const section=state.studySection,value=poem.study[section],paragraphs=Array.isArray(value)?value:value?[value]:[];
    return paragraphs.length?paragraphs.map((text,index)=>textUnit(section+'-'+index,index===0?studyNames[section]:'',text)):[textUnit(section+'-empty',studyNames[section],section==='background'?'这首诗的具体创作背景尚未确认。可通过下方的百度汉语参考继续了解。':'这一栏的资料还在整理中。','unavailable')];
  }
  function showPinyin(){ $('poetryScreen').classList.toggle('poetry-no-pinyin',!state.pinyin);$('poetryPinyin').checked=state.pinyin; }
  function rememberReader(){
    if(!state.currentId||state.reading.id!==state.currentId)return;
    const top=$('poetryBook').scrollTop;
    if(state.tab==='read')state.reading.read=top;
    else{if(!state.reading.study||typeof state.reading.study!=='object')state.reading.study={};state.reading.study[state.studySection]=top;}
  }
  function readerPosition(){const value=state.tab==='read'?state.reading.read:state.reading.study?.[state.studySection];return Number.isFinite(value)&&value>=0?value:0;}
  function studySpeech(poem){return state.studySection==='notes'?poem.notes.map(note=>note.word+'。'+note.meaning).join(''):([poem.study[state.studySection]].flat().filter(Boolean).join('。'));}
  function renderStudy(poem){
    $('poetryExplanation').innerHTML=unitsFor(poem,'explain').map(unit=>fragmentMarkup({unit,from:0,to:unit.parts.length})).join('');
    document.querySelectorAll('[data-poetry-study]').forEach(button=>{const selected=button.dataset.poetryStudy===state.studySection;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected)$('poetryStudyContent').setAttribute('aria-labelledby',button.id);});
    $('poetrySpeakLabel').textContent=state.tab==='read'?'听整首':'听'+studyNames[state.studySection];
    $('poetrySpeak').disabled=state.tab==='explain'&&!studySpeech(poem);
    const text=state.tab==='read'?poem.title+'。'+poem.author+'。'+poem.verses.map(v=>v.text).join(''):studySpeech(poem);
    const short=state.tab==='read'?poem.verses.slice(0,4).map(v=>v.text):state.studySection==='notes'?poem.notes.slice(0,4).map(note=>note.word+'。'+note.meaning):[];
    window.GameVoice?.prepare?.([...chunksFor(text).slice(0,2),...short],{owner:'poetry'});
  }
  function setStudySection(section,focus=false){
    if(!Object.hasOwn(studyNames,section))return;
    rememberReader();stopVoice();state.studySection=section;renderStudy(byId.get(state.currentId));
    $('poetryBook').scrollTop=readerPosition();$('poetrySpeechStatus').textContent=section==='notes'?'点词语可以听解释。':'可听'+studyNames[section]+'，长文可在框内滑动。';
    if(focus)document.querySelector(`[data-poetry-study="${section}"]`).focus({preventScroll:true});save();
  }
  function renderReaderContent(poem){
    const full=unit=>fragmentMarkup({unit,from:0,to:unit.parts.length}),verses=unitsFor(poem,'read');
    const rows=[];for(let i=0;i<verses.length;i+=2)rows.push('<div class="poetry-couplet'+(i+1===verses.length?' is-single':'')+'">'+verses.slice(i,i+2).map(full).join('')+'</div>');
    $('poetryVerses').innerHTML=rows.join('');renderStudy(poem);
  }
  function reflowReader(){
    const poem=byId.get(state.currentId);if(!poem)return;
    const width=$('poetryBook').clientWidth,paired=poem.verses.length>=8&&(poem.meter==='five'||(poem.meter==='seven'&&width>=660));
    $('poetryVerses').classList.toggle('is-paired',paired);
    $('poetryBook').classList.toggle('is-explaining',state.tab==='explain');
  }
  function reflowSheet(){const wanted=paging.anchor(sheetPages,sheetPage),pages=paging.paginate(sheetUnits,$('poetrySheetContent'),fragmentMarkup);if(!pages.length)return;sheetPages=pages;sheetPage=paging.locate(pages,wanted);renderSheetPage();}
  function renderSheetPage(){ $('poetrySheetContent').innerHTML=(sheetPages[sheetPage]||[]).map(fragmentMarkup).join('');$('poetrySheetPrevious').disabled=sheetPage===0;$('poetrySheetNext').disabled=sheetPage>=sheetPages.length-1;$('poetrySheetPage').textContent=`${sheetPage+1} / ${Math.max(1,sheetPages.length)} 页`; }
  function closeSheet(focus=true){if($('poetrySheet').hidden)return;$('poetrySheet').hidden=true;$('poetryCatalog').inert=false;$('poetryReader').inert=false;if(focus&&sheetOrigin?.getClientRects().length)sheetOrigin.focus({preventScroll:true});sheetOrigin=null;}
  function openSheet(title,units,origin){stopVoice();document.activeElement?.blur();sheetOrigin=origin;sheetUnits=units;sheetPages=[];sheetPage=0;$('poetrySheetTitle').textContent=title;$('poetrySheet').hidden=false;$('poetryCatalog').inert=true;$('poetryReader').inert=true;reflowSheet();$('poetrySheetTitle').focus({preventScroll:true});scheduleLayout();}
  function openDirectory(){
    const matches=poems,entries=[{meter:'all',genre:'all',name:'全部诗词',count:matches.length}];
    for(const meter of meterOrder)for(const genre of genreOrder)if(poems.some(p=>p.meter===meter&&p.genre===genre))entries.push({meter,genre,name:meterNames[meter]+genreNames[genre],count:matches.filter(p=>p.meter===meter&&p.genre===genre).length});
    const units=[];for(let i=0;i<entries.length;i+=2)units.push({key:'directory-'+i,kind:'directory',parts:[0],entries:entries.slice(i,i+2)});
    openSheet('分类目录',units,$('poetryOpenDirectory'));
  }
  function openAbout(){openSheet('关于这本诗集',[textUnit('about-0','从五言到七言','本选本保留原有 320 篇及阅读记录。“唐诗三百首”是诗集名称，部分组诗合为一篇。目录会按照屏幕大小调整每页篇数，用下方按钮翻页即可。'),textUnit('about-1','资料与讲解','以百度汉语为原文和注音核对参考，保留不同版本的异文。译文、词语注释、简析和赏析为童趣学堂编写的学习辅助内容，未确认的创作背景会明确标注。每篇讲解下方可打开百度汉语参考。'),textUnit('about-2','注音与朗读','注音采用普通话和常见古诗读法，少数字词存在不同读法。系统朗读可能与标注不同。点“异文”可以查看其他题名和写法。'+(data.referenceSummary||'')),textUnit('license','原文底本许可','原文底本来自 chinese-poetry 公开选本，继续保留其许可。\n'+data.license,'license')],$('poetryAbout'));}
  function resetVoiceUI(){
    $('poetryStop').hidden=true;$('poetrySpeak').hidden=false;$('poetrySpeak').removeAttribute('aria-busy');
    $('poetryVerses').querySelectorAll('.is-speaking').forEach(el=>el.classList.remove('is-speaking'));
  }
  window.addEventListener('globalvoicestop',()=>stopVoice('朗读设置已更改，请重新播放。'));
  function stopVoice(message){
    const hadJob=!!voiceJob;
    voiceSerial++;voiceJob=null;clearTimeout(voiceTimer);voiceTimer=null;
    if(window.GameVoice)window.GameVoice.stop('poetry');
    if(hadJob&&window.AndroidTts&&typeof window.AndroidTts.stop==='function'){try{window.AndroidTts.stop();}catch(_){}}
    if(utterance&&window.speechSynthesis){utterance.onend=null;utterance.onerror=null;utterance.onstart=null;try{window.speechSynthesis.cancel();}catch(_){}}
    utterance=null;resetVoiceUI();
    if(message)$('poetrySpeechStatus').textContent=message;
  }
  // A single request stays well below the preview service's 800-character limit.
  // Prefer punctuation so the next segment starts at a natural phrase boundary.
  function chunksFor(text){
    const normalized=text.replace(/\s+/g,' ').trim(),parts=normalized.match(/[^，。！？；：]+[，。！？；：]?/gu)||[normalized];
    const chunks=[];let current='';
    for(const phrase of parts){
      const chars=[...phrase];
      while(chars.length){
        const limit=chunks.length?220:80,piece=chars.splice(0,limit).join('');
        if(current&&[...current,...piece].length>limit){chunks.push(current);current='';}
        current+=piece;
      }
    }
    if(current)chunks.push(current);
    return chunks;
  }
  function say(text,label,verseIndex=null){
    if(!active||!state.currentId)return;
    stopVoice();
    const token=voiceSerial,job={token,label,chunks:chunksFor(text),index:0,nativeId:null};voiceJob=job;
    $('poetryStop').hidden=false;$('poetrySpeak').hidden=true;$('poetrySpeak').setAttribute('aria-busy','true');$('poetrySpeechStatus').textContent='正在准备'+label+'…';
    if(verseIndex!==null){const button=$('poetryVerses').querySelector(`[data-poetry-verse="${verseIndex}"]`);if(button)button.classList.add('is-speaking');}
    const current=()=>voiceJob===job&&voiceSerial===token&&active;
    function fail(message){
      if(!current())return;
      const native=!!window.AndroidTts,online=window.GlobalVoice?.voice?.()?.id.startsWith('online:');stopVoice(message|| (online?'在线声音暂时无法播放，请检查网络或回首页切换本机声音。':native?'手机中文语音暂不可用，可以打开中文语音设置后重试。':'语音暂时没播出来，请确认电脑预览在运行，再点一次。'));
      $('poetryVoiceSettings').hidden=!native||online;
    }
    function started(){
      if(!current())return;
      clearTimeout(voiceTimer);voiceTimer=null;
      $('poetrySpeechStatus').textContent='正在'+label+(job.chunks.length>1?` · 第 ${job.index+1} / ${job.chunks.length} 段`:'');
    }
    function finished(){
      if(!current())return;
      clearTimeout(voiceTimer);voiceTimer=null;job.index++;
      if(job.index<job.chunks.length){play();return;}
      voiceJob=null;utterance=null;resetVoiceUI();$('poetrySpeechStatus').textContent='读完了，可以再听一遍，也可以跟着自己读。';
    }
    job.started=started;job.finished=finished;job.fail=fail;
    function play(){
      if(!current())return;
      const part=job.chunks[job.index],rate=window.GlobalVoice?.rate?.()||.9,bridge=window.AndroidTts;
      window.GameVoice?.prepare?.(job.chunks.slice(job.index,job.index+3),{owner:'poetry',rate});
      if(bridge&&typeof bridge.speak==='function'){
        try{
          if(typeof bridge.speakWithId==='function'){
            job.nativeId=`poetry-${token}-${job.index}`;
            voiceTimer=setTimeout(()=>fail(),window.GlobalVoice?.voiceId?.().startsWith('online:')?40000:20000);
            bridge.speakWithId(part,rate,job.nativeId);
          }else{
            // Compatibility with older APKs whose bridge has no completion event.
            bridge.speak(text,rate);started();$('poetrySpeechStatus').textContent='已开始'+label+'，可以点“停止朗读”。';
          }
          if(typeof bridge.isReady==='function'&&!bridge.isReady()){$('poetryVoiceSettings').hidden=false;$('poetrySpeechStatus').textContent='正在准备手机中文语音；如果一直没有声音，可以打开中文语音设置。';}
          return;
        }catch(_){fail();return;}
      }
      if(window.GameVoice&&window.GameVoice.speak(part,{owner:'poetry',rate,onstart:started,onend:finished,onerror:error=>fail(error.message)}))return;
      if(window.speechSynthesis&&typeof window.SpeechSynthesisUtterance==='function'){
        try{
          utterance=new SpeechSynthesisUtterance(part);utterance.lang='zh-CN';utterance.rate=rate;
          const voices=window.speechSynthesis.getVoices();
          const voice=window.GlobalVoice?.pickBrowserVoice?.(voices)||voices.find(v=>/^zh([-_]|$)|cmn/i.test(v.lang));
          if(voice)utterance.voice=voice;
          utterance.onstart=started;utterance.onend=finished;utterance.onerror=()=>fail('浏览器没有播出中文语音，可以通过电脑 IP 的手机预览打开后再听。');
          voiceTimer=setTimeout(()=>fail('浏览器中文语音没有准备好，可以通过电脑 IP 的手机预览打开后再听。'),20000);
          window.speechSynthesis.resume();window.speechSynthesis.speak(utterance);return;
        }catch(_){fail();return;}
      }
      fail('当前浏览器没有中文语音。请通过电脑 IP 的手机预览打开，或在安卓安装版中设置中文语音。');
    }
    play();
  }
  window.addEventListener('androidtts',event=>{
    const detail=event.detail||{},job=voiceJob;
    if(!job||detail.id!==job.nativeId)return;
    if(detail.state==='start')job.started();else if(detail.state==='end')job.finished();else if(detail.state==='error')job.fail();else if(detail.state==='cancel')stopVoice('朗读已停止。');
  });

  function setTab(tab,focus=false,preserve=true){
    if(preserve)rememberReader();stopVoice();state.tab=tab;$('poetryReader').dataset.tab=tab;
    const read=tab==='read';$('poetryReadPanel').hidden=!read;$('poetryExplainPanel').hidden=read;
    $('poetryStudyTabs').hidden=read;
    $('poetryReadTab').setAttribute('aria-selected',String(read));$('poetryExplainTab').setAttribute('aria-selected',String(!read));
    $('poetryReadTab').tabIndex=read?0:-1;$('poetryExplainTab').tabIndex=read?-1:0;
    renderStudy(byId.get(state.currentId));$('poetrySpeechStatus').textContent=read?'点一句听朗读，长诗可在框内滑动。':'选择栏目阅读，也可以点按钮听讲解。';
    reflowReader();$('poetryBook').scrollTop=readerPosition();
    if(focus)$(read?'poetryReadTab':'poetryExplainTab').focus({preventScroll:true});scheduleLayout();save();
  }
  function renderReader(id){
    const poem=byId.get(id);state.currentId=id;state.lastId=id;state.visited.add(id);
    if(state.reading.id!==id)state.reading={id,read:0,explain:0};
    $('poetryReaderMeta').textContent=poem.type+' · '+poem.verses.length+' 句';
    $('poetryPoemTitle').innerHTML=ruby(poem.titleTokens);$('poetryPoemTitle').setAttribute('aria-label',poem.title);$('poetryPoemTitle').title=poem.title;
    $('poetryAuthor').innerHTML='<span class="poetry-dynasty" aria-hidden="true">唐</span>'+ruby(poem.authorTokens);$('poetryAuthor').setAttribute('aria-label','唐代，'+poem.author);
    $('poetryReference').href=poem.reference.url;$('poetryReference').target=window.AndroidTts?'_self':'_blank';$('poetryReference').setAttribute('aria-label','到百度汉语查看《'+poem.title+'》参考资料');
    const candidates=matching();readingSequence=candidates.some(p=>p.id===id)?candidates:poems;
    const index=readingSequence.findIndex(p=>p.id===id);$('poetryPrevious').disabled=index===0;$('poetryNext').disabled=index===readingSequence.length-1;$('poetrySequence').textContent=`${index+1} / ${readingSequence.length} 篇`;
    $('poetryVoiceSettings').hidden=true;renderReaderContent(poem);showPinyin();setTab('read',false,false);document.title=poem.title+' · 童趣学堂';save();
  }
  function navigate(id,replace=false){if(!byId.has(id))return;applySearch();save();const hash='#poetry/'+id;if(replace||location.hash===hash){history.replaceState(null,'',hash);window.dispatchEvent(new Event('hashchange'));}else location.hash=hash;}
  function catalogBack(){rememberReader();save();stopVoice();location.hash='poetry';}
  function activate(){
    stopVoice();clearTimeout(searchTimer);closeSheet(false);active=true;setViewport();
    const id=location.hash.slice(1).split('/')[1],poem=byId.get(id);
    if(poem){$('poetryCatalog').hidden=true;$('poetryReader').hidden=false;renderReader(id);$('poetryPoemTitle').focus({preventScroll:true});}
    else{state.currentId=null;window.GameVoice?.prepare?.([],{owner:'poetry'});$('poetryReader').hidden=true;$('poetryCatalog').hidden=false;renderCatalog();$('poetryTitle').focus({preventScroll:true});}
    window.scrollTo(0,0);scheduleLayout();
  }
  function scheduleLayout(){if(layoutFrame!==null)return;layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;if(!active)return;setViewport();if($('poetryReader').hidden)renderCatalog();else reflowReader();if(!$('poetrySheet').hidden)reflowSheet();window.scrollTo(0,0);});}
  function filterChanged(){clearTimeout(searchTimer);state.page=1;renderCatalog();save();}
  function applySearch(){clearTimeout(searchTimer);if(composing)return false;const query=$('poetrySearch').value.slice(0,100);if(query===state.query)return false;state.query=query;filterChanged();return true;}
  function scheduleSearch(){clearTimeout(searchTimer);$('poetryClearSearch').hidden=!$('poetrySearch').value;if(!composing)searchTimer=setTimeout(applySearch,180);}
  function turnPage(page){if(applySearch())return;const next=Math.max(1,Math.min(Math.ceil(filtered.length/pageSize)||1,page));if(next===state.page)return;state.page=next;renderCatalog();$('poetryResultCount').focus({preventScroll:true});}
  $('poetrySearch').addEventListener('compositionstart',()=>{composing=true;clearTimeout(searchTimer);});
  $('poetrySearch').addEventListener('compositionend',()=>{composing=false;scheduleSearch();});
  $('poetrySearch').addEventListener('input',event=>{if(!event.isComposing)scheduleSearch();});
  $('poetrySearch').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&!composing&&event.keyCode!==229){applySearch();event.target.blur();}});
  $('poetryClearSearch').addEventListener('click',()=>{state.query='';filterChanged();$('poetrySearch').focus();});
  document.querySelectorAll('[data-poetry-meter]').forEach(button=>button.addEventListener('click',()=>{composing=false;state.query='';state.meter=button.dataset.poetryMeter;state.genre='all';filterChanged();}));
  $('poetryGenre').addEventListener('change',event=>{composing=false;state.query='';state.genre=event.target.value;filterChanged();});
  document.querySelectorAll('[data-poetry-page-step]').forEach(button=>button.addEventListener('click',()=>turnPage(state.page+Number(button.dataset.poetryPageStep))));
  document.querySelector('[data-poetry-page-select]').addEventListener('change',event=>turnPage(Number(event.target.value)));
  $('poetryResetFilters').addEventListener('click',()=>{state.meter='all';state.genre='all';state.query='';filterChanged();});
  $('poetryList').addEventListener('click',event=>{const button=event.target.closest('[data-poetry-id]');if(button)navigate(button.dataset.poetryId);});
  $('poetryResume').addEventListener('click',()=>navigate(state.lastId));$('poetryBackCatalog').addEventListener('click',catalogBack);
  $('poetryAbout').addEventListener('click',openAbout);$('poetryOpenDirectory').addEventListener('click',()=>{applySearch();openDirectory();});
  $('poetryFullTitle').addEventListener('click',()=>{const poem=byId.get(state.currentId);if(poem)openSheet('题名与异文',[{key:'title',kind:'title',parts:poem.titleTokens},...(poem.variants.length?poem.variants.map((text,i)=>textUnit('variant-'+i,'其他写法',text)):[textUnit('variant-empty','原文','本篇没有记录其他写法。')])],$('poetryFullTitle'));});
  $('poetrySheetClose').addEventListener('click',()=>closeSheet());
  $('poetrySheetPrevious').addEventListener('click',()=>{if(sheetPage>0){sheetPage--;renderSheetPage();}});$('poetrySheetNext').addEventListener('click',()=>{if(sheetPage<sheetPages.length-1){sheetPage++;renderSheetPage();}});
  $('poetrySheetContent').addEventListener('click',event=>{const button=event.target.closest('[data-poetry-directory]');if(button&&!button.disabled){composing=false;state.query='';[state.meter,state.genre]=button.dataset.poetryDirectory.split('/');closeSheet();filterChanged();}});
  $('poetrySheet').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeSheet();}if(event.key==='Tab'){const targets=[...$('poetrySheet').querySelectorAll('button:not(:disabled),select')].filter(el=>el.getClientRects().length),first=targets[0],last=targets.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===$('poetrySheetTitle'))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
  $('poetryPinyin').addEventListener('change',event=>{state.pinyin=event.target.checked;showPinyin();save();scheduleLayout();});
  $('poetryReadTab').addEventListener('click',()=>setTab('read'));$('poetryExplainTab').addEventListener('click',()=>setTab('explain'));
  $('poetryStudyTabs').addEventListener('click',event=>{const button=event.target.closest('[data-poetry-study]');if(button)setStudySection(button.dataset.poetryStudy);});
  $('poetryStudyTabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const sections=Object.keys(studyNames),index=sections.indexOf(state.studySection),next=event.key==='Home'?0:event.key==='End'?sections.length-1:(index+(event.key==='ArrowRight'?1:-1)+sections.length)%sections.length;setStudySection(sections[next],true);});
  document.querySelector('.poetry-tabs').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setTab(event.key==='Home'?'read':event.key==='End'?'explain':state.tab==='read'?'explain':'read',true);}});
  $('poetryBook').addEventListener('scroll',()=>{rememberReader();clearTimeout(readerSaveTimer);readerSaveTimer=setTimeout(save,180);},{passive:true});
  $('poetrySpeak').addEventListener('click',()=>{const poem=byId.get(state.currentId);if(!poem)return;if(state.tab==='read')say(poem.title+'。'+poem.author+'。'+poem.verses.map(v=>v.text).join(''),'朗读《'+poem.title+'》');else{const text=studySpeech(poem);if(text)say(text,'读《'+poem.title+'》的'+studyNames[state.studySection]);}});
  $('poetryReference').addEventListener('click',()=>stopVoice());
  $('poetryVerses').addEventListener('click',event=>{const button=event.target.closest('[data-poetry-verse]'),poem=byId.get(state.currentId);if(button&&poem){const index=Number(button.dataset.poetryVerse);say(poem.verses[index].text,'朗读这一句',index);}});
  $('poetryExplanation').addEventListener('click',event=>{const button=event.target.closest('[data-poetry-word]'),poem=byId.get(state.currentId);if(button&&poem){const note=poem.notes[Number(button.dataset.poetryWord)];say(note.word+'。'+note.meaning,'解释“'+note.word+'”');}});
  $('poetryStop').addEventListener('click',()=>stopVoice('朗读已停止。'));$('poetryVoiceSettings').addEventListener('click',()=>{stopVoice();if(window.AndroidTts&&typeof window.AndroidTts.installChineseVoice==='function')window.AndroidTts.installChineseVoice();});
  function nextPoem(delta){const index=readingSequence.findIndex(p=>p.id===state.currentId),next=readingSequence[index+delta];if(next)navigate(next.id,true);}
  $('poetryPrevious').addEventListener('click',()=>nextPoem(-1));$('poetryNext').addEventListener('click',()=>nextPoem(1));
  window.addEventListener('learningmodechange',event=>{if(event.detail.mode==='poetry'){activate();return;}active=false;composing=false;clearTimeout(searchTimer);closeSheet(false);stopVoice();save();});
  window.addEventListener('resize',scheduleLayout);window.visualViewport?.addEventListener('resize',scheduleLayout);
  if(window.ResizeObserver){const observer=new ResizeObserver(scheduleLayout);['poetryList','poetryVerses','poetryExplanation','poetrySheetContent'].forEach(id=>observer.observe($(id)));}
  document.fonts?.ready.then(scheduleLayout);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopVoice('朗读已停止。');save();}});window.addEventListener('pagehide',()=>{stopVoice();save();});
  window.TangPoetryUI=Object.freeze({back:()=>{if(!active)return false;if(!$('poetrySheet').hidden){closeSheet();return true;}if($('poetryReader').hidden)return false;if(state.tab==='explain'){setTab('read',true);return true;}catalogBack();return true;}});
  $('homePoetryArt').innerHTML=art.bookCover();showPinyin();
})();
