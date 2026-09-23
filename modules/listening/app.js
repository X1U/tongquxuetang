(()=>{
  'use strict';
  const $=id=>document.getElementById(id),data=window.ListeningLessons,art=window.ListeningArt,voice=window.ListeningAudio;
  const storageKey='tongqu-listening-v1',sounds=new Map(data.sounds.map(s=>[s.id,s]));
  const prefs={soundMode:'single',category:'all',trainMode:'commands',level:2};
  const progress={sound:0,train:0,commands:[],sentences:[]};
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(saved){
      for(const [key,allowed] of Object.entries({soundMode:['single','sequence'],category:['all','body','objects'],trainMode:['commands','repeat'],level:[1,2,3]}))if(allowed.includes(saved.prefs?.[key]))prefs[key]=saved.prefs[key];
      for(const key of ['sound','train'])if(Number.isSafeInteger(saved.progress?.[key])&&saved.progress[key]>=0)progress[key]=saved.progress[key];
      for(const [key,pool] of [['commands',data.commands],['sentences',data.sentences]])progress[key]=[...new Set((Array.isArray(saved.progress?.[key])?saved.progress[key]:[]).filter(id=>pool.some(item=>item.id===id)))];
    }
  }catch(_){}
  const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify({prefs,progress}));}catch(_){}};
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const shuffled=items=>{const copy=[...items];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;};
  const bags=new Map(),last=new Map();
  function draw(key,pool,exclude=[]){
    let bag=bags.get(key)||[];
    if(!bag.length)bag=shuffled(pool.map(item=>item.id));
    let index=bag.findIndex(id=>id!==last.get(key)&&!exclude.includes(id));
    if(index<0)index=bag.findIndex(id=>!exclude.includes(id));
    if(index<0){const id=shuffled(pool.map(item=>item.id).filter(id=>!exclude.includes(id)))[0];last.set(key,id);bags.set(key,bag);return id;}
    const [id]=bag.splice(index,1);bags.set(key,bag);last.set(key,id);return id;
  }
  let active='',sound=null,train=null,dialogState=null,returnFocus=null,answerEffectTimer;
  const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clearAnswerEffect(){
    clearTimeout(answerEffectTimer);
    $('soundOptions').querySelectorAll('[data-answer-feedback]').forEach(button=>delete button.dataset.answerFeedback);
    $('soundOptions').querySelectorAll('.sound-answer-effect').forEach(effect=>effect.remove());
  }
  function clearEffects(){
    clearAnswerEffect();
    document.querySelectorAll('.listen-star').forEach(star=>star.getAnimations?.().forEach(animation=>animation.cancel()));
  }
  function answerEffect(id,correct){
    clearAnswerEffect();
    const button=$('soundOptions').querySelector('[data-sound-choice="'+id+'"]');
    if(!button)return;
    button.dataset.answerFeedback=correct?'correct':'retry';
    const effect=document.createElement('span');effect.className='sound-answer-effect';effect.setAttribute('aria-hidden','true');
    effect.innerHTML='<span class="sound-result-badge"><b>'+(correct?'✓':'↻')+'</b>'+(correct?(sound.done?'答对啦！':'找对啦！'):'再试试')+'</span>';
    if(correct&&!reducedMotion()){
      for(const [x,y] of [[-45,-28],[46,-28],[-54,13],[53,16],[-19,-45],[23,41]]){
        const spark=document.createElement('span');spark.className='sound-spark';spark.style.setProperty('--spark-x',x+'px');spark.style.setProperty('--spark-y',y+'px');spark.innerHTML=art.star();effect.append(spark);
      }
    }
    button.append(effect);answerEffectTimer=setTimeout(clearAnswerEffect,1050);
  }
  function awardStar(which){
    const star=$(which+'Stars').children[(progress[which]-1)%5];
    if(star?.animate&&!reducedMotion())star.animate([{transform:'scale(1)'},{offset:.4,transform:'translateY(-4px) scale(1.3)'},{transform:'scale(1)'}],{duration:620,easing:'cubic-bezier(.22,1,.36,1)'});
  }
  function feedback(which,text,tone='normal'){$(which+'Feedback').textContent=text;$(which+'Feedback').dataset.tone=tone;}
  function progressView(which){
    const total=progress[which],count=total?((total-1)%5)+1:0;
    $(which+'Stars').innerHTML=art.stars(total);$(which+'Stars').setAttribute('aria-label','本轮获得 '+count+' 颗星，共 5 颗');
    $(which+'Progress').textContent=total&&count===5?(which==='sound'?'侦探徽章点亮了！':'到达星星站啦！')+' 已完成 '+total+' 个任务':(which==='sound'?'集齐 5 颗星，点亮侦探徽章':'每完成 1 个任务，小火车前进一站');
  }
  function renderSound(){
    window.GameVoice?.prepare?.([],{owner:'listening'});
    if(!sound)return;
    const sequence=prefs.soundMode==='sequence';
    document.querySelectorAll('[data-sound-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.soundMode===prefs.soundMode)));
    $('soundCategory').value=prefs.category;
    $('soundCollection').textContent=(prefs.category==='all'?data.sounds.length:data.sounds.filter(s=>s.category===prefs.category).length)+' 种真实声音';
    $('soundPrompt').textContent=sequence?'先听到谁，后听到谁？':'谁发出了这个声音？';
    $('soundPlay').textContent=sound.busy?'重新播放':sound.heard?'再听一遍':sequence?'听两个声音':'听听声音';
    $('soundPlay').setAttribute('aria-busy',String(sound.busy));$('soundStop').hidden=!sound.busy;
    $('soundScreen').classList.toggle('is-playing',sound.busy);
    $('soundOrder').hidden=!sequence;
    $('soundOrder').innerHTML=sound.target.map((id,i)=>'<span class="sound-order-slot'+(sound.selected.length>i?' filled':'')+'"><b>'+(i+1)+'</b> '+(sound.selected.length>i?escape(sounds.get(id).label):'？')+'</span>').join('<span aria-hidden="true">→</span>');
    $('soundOptions').innerHTML=sound.options.map(id=>{
      const item=sounds.get(id),selected=sound.selected.indexOf(id);
      return '<button type="button" class="sound-option'+(selected>=0?' selected':'')+(sound.wrong===id?' retry':'')+'" data-sound-choice="'+id+'"'+(!sound.heard||sound.busy||sound.done||selected>=0?' disabled':'')+' aria-label="'+escape(item.label)+(selected>=0?'，第'+(selected+1)+'个声音':'')+'"><img src="'+item.image+'" alt="" draggable="false" width="280" height="260"><span>'+escape(item.label)+'</span>'+(selected>=0?'<b class="sound-answer-mark">'+(sequence?selected+1:'✓')+'</b>':'')+'</button>';
    }).join('');
    $('soundHint').disabled=!sound.heard||sound.busy||sound.done;
    $('soundNext').textContent=sound.done?'下一题':'换一题';progressView('sound');
  }
  function nextSound(){
    clearAnswerEffect();voice.stop();
    const pool=data.sounds.filter(item=>prefs.category==='all'||item.category===prefs.category),key='sounds-'+prefs.category;
    const target=[draw(key,pool)];if(prefs.soundMode==='sequence')target.push(draw(key,pool,target));
    const options=shuffled([...target,...shuffled(pool.filter(s=>!target.includes(s.id))).slice(0,4-target.length).map(s=>s.id)]);
    sound={target,options,selected:[],heard:false,busy:false,done:false,wrong:null};
    renderSound();feedback('sound','先点“'+(prefs.soundMode==='sequence'?'听两个声音':'听听声音')+'”，听完再选图片。');
  }
  function playSound(){
    if(!sound||active!=='sound')return;
    clearAnswerEffect();voice.stop();const question=sound;question.busy=true;question.wrong=null;renderSound();
    voice.play(question.target.map(id=>({audio:sounds.get(id).audio})),{
      onpart:index=>{if(sound===question)feedback('sound','正在准备第 '+(index+1)+' 个声音…');},
      onstart:index=>{if(sound===question)feedback('sound','正在听第 '+(index+1)+' 个声音'+(question.target.length>1?'，记住先后顺序。':'，仔细听一听。'));},
      onend:()=>{if(sound!==question)return;question.busy=false;question.heard=true;renderSound();feedback('sound',question.done?'可以再听一次，或进入下一题。':question.target.length>1?'听完啦！先点第一个声音的图片。':'听完啦！点出声音对应的图片。');},
      oncancel:()=>{if(sound!==question)return;question.busy=false;renderSound();feedback('sound','播放已停止，可以重新听一遍。');},
      onerror:()=>{if(sound!==question)return;question.busy=false;renderSound();feedback('sound','声音没有完整播放，请点播放按钮重试。','retry');}
    });
  }
  function chooseSound(id){
    if(active!=='sound'||!sound?.heard||sound.busy||sound.done||!sound.options.includes(id)||sound.selected.includes(id))return;
    if(id!==sound.target[sound.selected.length]){sound.wrong=id;feedback('sound','还没找到，再听一遍，或点“给我线索”。','retry');renderSound();answerEffect(id,false);return;}
    sound.wrong=null;sound.selected.push(id);
    if(sound.selected.length===sound.target.length){
      sound.done=true;progress.sound++;save();
      feedback('sound','找到了！'+sound.target.map(id=>sounds.get(id).label).join(' → ')+'。得到一颗星！','success');
    }else feedback('sound','第一个找对了！再选第二个声音。','success');
    renderSound();answerEffect(id,true);if(sound.done)awardStar('sound');
  }
  function renderTrain(){
    if(!train)return;
    const repeat=prefs.trainMode==='repeat';
    window.GameVoice?.prepare?.([repeat?train.item.text+'。':commandText(train.item),...(repeat?train.item.chunks:[])],{owner:'listening'});
    document.querySelectorAll('[data-train-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.trainMode===prefs.trainMode)));
    $('trainLevel').value=String(prefs.level);$('trainLevelLabel').hidden=repeat;$('trainSentenceCount').hidden=!repeat;$('trainChunks').hidden=!repeat;
    $('trainTaskNumber').textContent=repeat?'九字传话 · '+train.item.number+' / 20':'听令行动 · '+prefs.level+' 步';
    $('trainPrompt').textContent=train.done?'又完成一个任务！':train.busy?'小耳朵认真听':train.heard?'轮到你啦！':repeat?'把一句话装进小火车':'听完再行动';
    $('trainInstruction').textContent=train.done?'星星已装好，准备前往下一站。':train.heard?(repeat?'不看文字，把刚才的话完整说出来。':'按照刚才的顺序，完成 '+prefs.level+' 个动作。'):(repeat?'听清九个字，记住后说给家长听。':'先听完整个任务，再开始做动作。');
    $('trainMemory').classList.toggle('nine-words',repeat);
    $('trainMemory').innerHTML=Array.from({length:repeat?9:prefs.level},(_,i)=>'<span class="train-memory-slot'+(train.done?' filled':'')+'">'+(train.done?'★':repeat?'•':i+1)+'</span>').join('');
    $('trainPlay').textContent=train.busy?'重新播放':train.heard?'再听一遍':repeat?'听听句子':'听听任务';
    $('trainPlay').setAttribute('aria-busy',String(train.busy));$('trainStop').hidden=!train.busy;
    $('trainReview').disabled=!train.heard||train.busy||train.done;
    $('trainReview').textContent=train.done?'任务已完成':repeat?'我说完了':'我做完了';
    $('trainNext').textContent=train.done?'下一站':'换一题';
    $('trainScreen').classList.toggle('is-playing',train.busy);$('trainScreen').classList.toggle('task-complete',train.done);progressView('train');
  }
  function nextTrain(){
    // Ignore the old player's cancellation callback after the activity type changes.
    train=null;closeDialog();voice.stop();const pool=prefs.trainMode==='repeat'?data.sentences:data.commands.filter(item=>item.parts.length===prefs.level);
    const id=draw('train-'+prefs.trainMode+'-'+(prefs.trainMode==='commands'?prefs.level:0),pool);
    train={item:pool.find(item=>item.id===id),heard:false,busy:false,done:false};
    renderTrain();feedback('train',prefs.trainMode==='repeat'?'点“听听句子”，听完后自己说一遍。':'点“听听任务”，小火车等你出发。');
  }
  function commandText(item){return item.parts.map((part,i)=>(i===0?'先':i===item.parts.length-1?'再':'然后')+part[1]).join('，')+'。';}
  function playTrain(){
    if(!train||active!=='train')return;
    voice.stop();const question=train;question.busy=true;renderTrain();feedback('train','正在准备中文语音…');
    const text=prefs.trainMode==='repeat'?question.item.text+'。':commandText(question.item);
    voice.play([text],{rate:window.GlobalVoice?.rate?.()||.9,
      onstart:()=>{if(train===question)feedback('train','正在播放，听完再做、再说。');},
      onend:()=>{if(train!==question)return;question.busy=false;question.heard=true;renderTrain();feedback('train',question.done?'还可以再练一次，或点“下一站”。':'轮到你了，完成后请家长一起核对。');},
      oncancel:()=>{if(train!==question)return;question.busy=false;renderTrain();feedback('train','播放已停止，可以重新听一遍。');},
      onerror:message=>{if(train!==question)return;question.busy=false;renderTrain();feedback('train',message,'retry');}
    });
  }
  const dialog=$('listenDialog');
  function closeDialog(){
    if(!dialog.open)return;
    // Stop within the tap handler; the dialog's close event is delivered later.
    voice.stop();dialogState=null;const target=returnFocus;returnFocus=null;dialog.close();
    if(target?.isConnected&&target.getClientRects().length)target.focus({preventScroll:true});
  }
  function openDialog(title,body,actions,state){
    clearEffects();voice.stop();returnFocus=document.activeElement;dialogState=state||{kind:'help'};
    $('listenDialogTitle').textContent=title;$('listenDialogBody').innerHTML=body;$('listenDialogStatus').textContent='';$('listenDialogActions').innerHTML=actions;
    if(!dialog.open)dialog.showModal();
  }
  function taskContent(item,repeat,review=false){
    if(repeat)return '<div class="listen-sentence">'+escape(item.text)+'</div>'+(review?'<p>听孩子完整说一遍，再逐项确认。</p>':'<p>先听整句；需要帮助时，可以一段一段练。</p>');
    return '<ol class="listen-steps">'+item.parts.map(([icon,text],i)=>'<li>'+art.icon(icon)+'<span><small>第 '+(i+1)+' 步</small><strong>'+escape(text)+'</strong></span></li>').join('')+'</ol>';
  }
  function showTrainHint(){
    if(!train)return;
    const repeat=prefs.trainMode==='repeat',question=train;
    openDialog(repeat?'九字小纸条':'任务小纸条',taskContent(question.item,repeat)+'<p class="listen-parent-note">先由家长读一遍，再收起文字让孩子试一试。</p>',(!question.heard?'<button type="button" class="listen-primary" data-listen-action="parent-read">家长已读完，开始试试</button>':'<button type="button" class="listen-primary" data-listen-action="close">收起提示，自己试试</button>'),{kind:'hint',question});
  }
  function showChunks(){
    if(!train||prefs.trainMode!=='repeat')return;
    openDialog('一句一句，慢慢记',taskContent(train.item,true)+'<div class="listen-chunks">'+train.item.chunks.map((text,i)=>'<button type="button" data-listen-part="'+i+'"><small>第 '+(i+1)+' 段 · 点我听</small><strong>'+escape(text)+'</strong></button>').join('')+'</div>','<button type="button" class="listen-primary" data-listen-action="close">回去听整句</button>',{kind:'chunks',question:train});
  }
  function showReview(){
    if(!train?.heard||train.busy||train.done)return;
    const repeat=prefs.trainMode==='repeat';
    const checks=repeat?train.item.chunks.map(text=>'说出了“'+text+'”'):train.item.parts.map((part,i)=>(i+1)+'. '+part[1]);
    if(repeat||checks.length>1)checks.push(repeat?'词语顺序正确，没有漏词':'按刚才听到的顺序完成');
    openDialog('请家长一起核对',taskContent(train.item,repeat,true)+'<div class="listen-checks">'+checks.map((text,i)=>'<label><input type="checkbox" data-listen-check="'+i+'"><span>'+escape(text)+'</span></label>').join('')+'</div><p class="listen-parent-note">本题由家长确认。再练习也没关系，星星会等你。</p>','<button type="button" class="listen-secondary" data-listen-action="practice">再练一次</button><button type="button" class="listen-primary" id="listenApprove" data-listen-action="approve" disabled>确认完成，装上星星</button>',{kind:'review',question:train});
  }
  function showHelp(which){
    const text=which==='sound'?'<p>听音找图：听完真实声音，点出对应图片。</p><p>先后顺序：连续听两个声音，按先后顺序点两张图片。第一张选对后，再选第二张。</p><p>可以选择身体声音或生活物品，也可以随时重听。选错了继续尝试，找到一题获得一颗星。</p><p>24 段音效和图片来自你提供的《辨听人体和物体的声音》，已随页面打包。</p>':'<p>听令行动：选择一步、两步或三步，听完后再按顺序做动作。</p><p>九字传话：听完整句，收起文字说给家长听。需要帮助时可查看文字或分段练习。</p><p>完成后点“我做完了”或“我说完了”，由家长核对并点亮星星。动作和复述由家长判断，不使用麦克风或自动评分。</p><p>发音人和语速在首页统一设置。</p><p>36 条指令选编自《听觉指令训练-》，20 句九字句来自《言语复述9个字》。第三句已改正为“我们一起去玩摩天轮”。</p>';
    openDialog(which==='sound'?'声音侦探怎么玩':'听说小火车怎么玩',text+'<p>每完成 5 个任务获得一次到站奖励，累计进度会保存在这台设备。</p>',(which==='train'&&window.AndroidTts?'<button type="button" class="listen-secondary" data-listen-action="voice-settings">中文语音设置</button>':'')+'<button type="button" class="listen-primary" data-listen-action="close">知道啦，出发</button>');
  }
  $('soundPlay').addEventListener('click',playSound);$('soundStop').addEventListener('click',()=>voice.stop());$('soundNext').addEventListener('click',nextSound);
  $('soundOptions').addEventListener('click',event=>{const button=event.target.closest('[data-sound-choice]');if(button)chooseSound(button.dataset.soundChoice);});
  $('soundHint').addEventListener('click',()=>{if(!sound?.heard||sound.busy||sound.done)return;clearAnswerEffect();feedback('sound','线索：'+sounds.get(sound.target[sound.selected.length]).clue);});
  document.querySelectorAll('[data-sound-mode]').forEach(button=>button.addEventListener('click',()=>{if(prefs.soundMode===button.dataset.soundMode)return;prefs.soundMode=button.dataset.soundMode;save();nextSound();}));
  $('soundCategory').addEventListener('change',()=>{prefs.category=$('soundCategory').value;save();nextSound();});
  document.querySelectorAll('[data-train-mode]').forEach(button=>button.addEventListener('click',()=>{if(prefs.trainMode===button.dataset.trainMode)return;prefs.trainMode=button.dataset.trainMode;save();nextTrain();}));
  $('trainLevel').addEventListener('change',()=>{prefs.level=Number($('trainLevel').value);save();nextTrain();});
  $('trainPlay').addEventListener('click',playTrain);$('trainStop').addEventListener('click',()=>voice.stop());$('trainNext').addEventListener('click',nextTrain);
  $('trainHint').addEventListener('click',showTrainHint);$('trainChunks').addEventListener('click',showChunks);$('trainReview').addEventListener('click',showReview);
  document.querySelectorAll('[data-listen-help]').forEach(button=>button.addEventListener('click',()=>showHelp(button.dataset.listenHelp)));
  $('listenDialogClose').addEventListener('click',closeDialog);
  dialog.addEventListener('close',()=>{if(dialog.open||!dialogState)return;voice.stop();dialogState=null;if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus({preventScroll:true});returnFocus=null;});
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('change',()=>{const approve=$('listenApprove');if(approve)approve.disabled=![...dialog.querySelectorAll('[data-listen-check]')].every(input=>input.checked);});
  dialog.addEventListener('click',event=>{
    const part=event.target.closest('[data-listen-part]');
    if(part&&dialogState?.kind==='chunks'&&dialogState.question===train){
      const sentence=train.item.chunks[Number(part.dataset.listenPart)],state=dialogState;
      voice.stop();$('listenDialogStatus').textContent='正在准备…';
      voice.play([sentence],{rate:window.GlobalVoice?.rate?.()||.9,onstart:()=>{if(dialogState===state)$('listenDialogStatus').textContent='正在朗读：'+sentence;},onend:()=>{if(dialogState===state)$('listenDialogStatus').textContent='跟着说一遍，再点下一段。';},oncancel:()=>{if(dialogState===state)$('listenDialogStatus').textContent='已停止。';},onerror:message=>{if(dialogState===state)$('listenDialogStatus').textContent=message;}});return;
    }
    const button=event.target.closest('[data-listen-action]');if(!button||button.disabled)return;
    const action=button.dataset.listenAction;
    if(action==='voice-settings'){window.AndroidTts?.installChineseVoice();return;}
    if(action==='close'||action==='practice'){closeDialog();if(action==='practice')feedback('train','再听一遍，慢慢来，完成后再请家长核对。');return;}
    if(dialogState?.question!==train||active!=='train')return;
    if(action==='parent-read'&&dialogState.kind==='hint'){train.heard=true;closeDialog();renderTrain();feedback('train','家长已读题，轮到你来试试啦！');return;}
    if(action==='approve'&&dialogState.kind==='review'&&train.heard&&!train.done){
      const checks=[...dialog.querySelectorAll('[data-listen-check]')];if(!checks.length||!checks.every(input=>input.checked))return;
      train.done=true;progress.train++;const key=prefs.trainMode==='commands'?'commands':'sentences';if(!progress[key].includes(train.item.id))progress[key].push(train.item.id);save();closeDialog();renderTrain();awardStar('train');feedback('train','家长确认完成！一颗星星装上车，小火车前进啦。','success');
    }
  });
  $('homeSoundArt').innerHTML=art.ear();$('homeTrainArt').innerHTML=art.train();$('soundEar').innerHTML=art.ear();$('trainArt').innerHTML=art.train();
  const viewport=()=>document.documentElement.style.setProperty('--listening-vh',Math.round(window.visualViewport?.height||innerHeight)+'px');
  window.addEventListener('resize',viewport);window.visualViewport?.addEventListener('resize',viewport);viewport();
  window.addEventListener('learningmodechange',event=>{
    clearEffects();closeDialog();active=event.detail.mode;
    if(active==='sound'){if(!sound)nextSound();else renderSound();}
    if(active==='train'){if(!train)nextTrain();else renderTrain();}
  });
  window.addEventListener('pagehide',clearEffects);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearEffects();});
  window.ListeningGames=Object.freeze({back:()=>{if(!dialog.open)return false;closeDialog();return true;}});
})();
