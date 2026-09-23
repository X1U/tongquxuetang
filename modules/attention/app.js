(()=>{
  'use strict';
  const $=id=>document.getElementById(id),data=window.AttentionLessons,voice=window.ListeningAudio;
  const storageKey='tongqu-attention-v1',cards=new Map(data.cards.map(card=>[card.id,card]));
  const records={},bags=new Map();
  let level=1,active=false,session=null,audioToken=0,dialogState=null,returnFocus=null;
  const escape=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function shuffled(values){
    const copy=[...values];
    for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
    return copy;
  }
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(data.levels.some(item=>item.id===saved?.level))level=saved.level;
    for(const [id,record] of Object.entries(saved?.records||{})){
      if(cards.has(id)&&Number.isSafeInteger(record?.best)&&record.best>=0&&record.best<=cards.get(id).questions.length&&Number.isSafeInteger(record.attempts)&&record.attempts>0){records[id]={best:record.best,attempts:record.attempts};}
    }
  }catch(_){}
  function save(){try{localStorage.setItem(storageKey,JSON.stringify({level,records}));}catch(_){}}
  function feedback(text,tone='normal'){$('attentionStatus').textContent=text;$('attentionStatus').dataset.tone=tone;}
  function questionSpeech(run,index=run.index){
    const question=run.card.questions[index];
    if(!question)return '';
    let text=question.prompt+run.options[index].map((option,i)=>['第一项，','第二项，','第三项，'][i]+option+'。').join('');
    if(run.answers[index]!==null)text+='这题的答案是，'+question.answer+'。';
    return text;
  }
  function prepare(){
    if(!active||!session)return;
    const run=session;
    window.GameVoice?.prepare?.([run.card.sentence,questionSpeech(run),questionSpeech(run,run.index+1)],{owner:'listening'});
  }
  function render(){
    const run=session;if(!run)return;
    const {card,stage}=run,question=card.questions[run.index],choice=run.answers[run.index];
    const count=card.questions.length,answered=choice!==null;
    $('attentionLevel').value=String(level);
    $('attentionCardNumber').textContent='卡 '+String(data.cards.indexOf(card)+1).padStart(2,'0')+(stage==='questions'?' · '+(run.index+1)+' / '+count+' 问':' · 本档 8 张');
    $('attentionQuestionCount').textContent='听完后回答 '+count+' 个问题';
    $('attentionListenTitle').textContent=run.busy==='sentence'?'小耳朵，认真听':run.heard?'听完啦，轮到你回答':'用小耳朵记住一句话';
    $('attentionListenHint').textContent=run.heard?'准备好了就点“开始答题”，也可以再听一次。':data.levels.find(item=>item.id===level).hint+'。';
    for(const name of ['listen','questions','result']){
      const step=document.querySelector('[data-attention-step="'+name+'"]');
      if(name===stage)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
    }
    $('attentionListenPanel').hidden=stage!=='listen';$('attentionQuestionPanel').hidden=stage!=='questions';$('attentionResultPanel').hidden=stage!=='result';
    $('attentionScreen').classList.toggle('is-playing',!!run.busy);
    $('attentionPlayLabel').textContent=stage==='listen'?(run.heard?'再听一遍':run.busy==='sentence'?'重新播放':'听一句话'):stage==='result'?'再听原句':'重听原句';
    $('attentionPlay').setAttribute('aria-busy',String(run.busy==='sentence'));
    $('attentionStop').hidden=!run.busy;$('attentionParent').hidden=stage==='result';
    $('attentionReadQuestion').textContent=run.busy==='question'?'重读':'听题';
    $('attentionReadQuestion').setAttribute('aria-label',answered?'朗读问题、全部选项和正确答案':'朗读问题和全部选项');
    $('attentionReadQuestion').setAttribute('aria-busy',String(run.busy==='question'));
    $('attentionContinue').disabled=!!run.busy||(stage==='listen'&&!run.heard)||(stage==='questions'&&!answered);
    $('attentionContinue').textContent=stage==='listen'?'开始答题':stage==='result'?'再练这张':run.index===count-1?'看结果':'下一问';
    $('attentionNextCard').textContent=stage==='result'?'下一张':'换一张';
    const best=records[card.id];
    $('attentionProgress').textContent='已完成 '+Object.keys(records).length+' / '+data.cards.length+' 张'+(best?' · 这张最好答对 '+best.best+' / '+count+' 问':' · 慢慢听，不用抢答');
    if(stage==='questions'){
      $('attentionQuestionNumber').textContent='问题 '+(run.index+1)+' / '+count;
      $('attentionQuestion').textContent=question.prompt;
      $('attentionOptions').innerHTML=run.options[run.index].map((option,index)=>{
        const selected=choice===option,correct=answered&&option===question.answer,wrong=selected&&!correct;
        const mark=correct?'正确答案':wrong?'你的选择':'';
        return '<button type="button" class="attention-option'+(correct?' is-correct':'')+(wrong?' is-wrong':'')+'" data-attention-choice="'+index+'" aria-pressed="'+selected+'"'+(run.busy||answered?' disabled':'')+'><span class="attention-option-number" aria-hidden="true">'+(index+1)+'</span><span class="attention-option-text">'+escape(option)+'</span><span class="attention-option-mark">'+mark+'</span></button>';
      }).join('');
    }
    if(stage==='result'){
      const score=run.answers.filter((answer,index)=>answer===card.questions[index].answer).length;
      $('attentionResultTitle').textContent='答对 '+score+' / '+count+' 问';
      $('attentionResultNote').textContent=(score===count?'这些细节都记住啦！':'一起回顾没记住的细节，再试一次也很好。')+(run.assisted?' 本次用过原句提示。':'');
      $('attentionSentence').textContent=card.sentence;
      $('attentionReview').innerHTML=card.questions.map((item,index)=>'<li><span class="attention-review-question">'+escape(item.prompt)+'</span><span class="attention-review-answer">'+(run.answers[index]===item.answer?'答对了：':'答案：')+escape(item.answer)+'</span>'+(run.answers[index]!==item.answer?'<span class="attention-review-wrong">这次选了：'+escape(run.answers[index])+'</span>':'')+'</li>').join('');
    }
  }
  function halt(silent=false){
    audioToken++;
    const wasPlaying=!!session?.busy;
    if(session)session.busy=false;
    if(wasPlaying)voice.stop(false);
    if(active&&session){render();if(wasPlaying&&!silent)feedback('播放已停止，可以重新听一遍。');}
  }
  function startCard(card){
    halt(true);closeDialog(false);
    session={card,stage:'listen',index:0,heard:false,busy:false,assisted:false,answers:card.questions.map(()=>null),options:card.questions.map(question=>shuffled(question.options))};
    render();$('attentionContent').scrollTop=0;prepare();feedback('先听完一句话，再来回答问题。');
  }
  function nextCard(){
    const pool=data.cards.filter(card=>card.level===level);
    let bag=bags.get(level)||[];
    if(!bag.length)bag=shuffled(pool.map(card=>card.id));
    if(bag.length>1&&bag[0]===session?.card.id)[bag[0],bag[1]]=[bag[1],bag[0]];
    const id=bag.shift();bags.set(level,bag);startCard(cards.get(id));
  }
  function play(kind){
    if(!active||!session||dialog.open||(kind==='question'&&session.stage!=='questions'))return;
    halt(true);const run=session,token=++audioToken;
    const current=()=>active&&session===run&&audioToken===token;
    run.busy=kind;render();feedback(kind==='sentence'?'正在准备原句…':'正在准备问题和选项…');
    voice.play([kind==='sentence'?run.card.sentence:questionSpeech(run)],{
      rate:window.GlobalVoice?.rate?.()||.9,
      onstart:()=>{if(current()){feedback(kind==='sentence'?'认真听，记住句子里的细节。':'正在朗读问题和三个选项。');prepare();}},
      onend:()=>{
        if(!current())return;run.busy=false;if(kind==='sentence')run.heard=true;render();prepare();
        feedback(run.stage==='listen'?'听完啦！点“开始答题”，也可以再听一次。':run.stage==='result'?'对照原句回顾答案，也可以再练这张卡。':run.answers[run.index]!==null?'这题已经回答，可以继续下一步。':'选一个答案；需要时可以重听原句或点“听题”。');
      },
      oncancel:()=>{if(current()){audioToken++;run.busy=false;render();feedback('播放已停止，可以重新听一遍。');}},
      onerror:message=>{if(current()){audioToken++;run.busy=false;render();feedback(message||'声音暂时无法播放，可以重试或请家长读题。','retry');}}
    });
  }
  function choose(index){
    const run=session;
    if(!active||!run||run.stage!=='questions'||run.busy||run.answers[run.index]!==null||dialog.open)return;
    const selected=run.options[run.index][index];if(typeof selected!=='string')return;
    run.answers[run.index]=selected;render();prepare();
    const correct=selected===run.card.questions[run.index].answer;
    feedback(correct?'答对了！记住这个细节，继续下一步。':'这题的答案是“'+run.card.questions[run.index].answer+'”，记住后再继续。',correct?'success':'retry');
    $('attentionContinue').focus({preventScroll:true});
  }
  function advance(){
    const run=session;if(!active||!run||run.busy||dialog.open)return;
    if(run.stage==='result'){startCard(run.card);return;}
    if(run.stage==='listen'){
      if(!run.heard)return;
      run.stage='questions';render();prepare();feedback('选一个答案，也可以点“听题”听问题和选项。');
    }else{
      if(run.answers[run.index]===null)return;
      if(run.index<run.card.questions.length-1){run.index++;render();prepare();feedback('再想想刚才听到的句子，这一问选什么？');}
      else{
        run.stage='result';
        const score=run.answers.filter((answer,index)=>answer===run.card.questions[index].answer).length,old=records[run.card.id];
        records[run.card.id]={best:Math.max(old?.best||0,score),attempts:Math.min(Number.MAX_SAFE_INTEGER,(old?.attempts||0)+1)};
        save();render();prepare();feedback('这张卡完成啦！一起回看原句和答案。','success');
      }
    }
    $('attentionContent').scrollTop=0;$(run.stage==='result'?'attentionResultTitle':'attentionQuestion').focus({preventScroll:true});
  }
  const dialog=$('attentionDialog');
  function closeDialog(restoreFocus=true){
    if(!dialog.open)return;
    dialogState=null;const target=returnFocus;returnFocus=null;dialog.close();
    if(restoreFocus&&target?.isConnected&&target.getClientRects().length)target.focus({preventScroll:true});
  }
  function openDialog(title,body,state){
    halt(true);returnFocus=document.activeElement;dialogState=state;
    $('attentionDialogTitle').textContent=title;$('attentionDialogBody').innerHTML=body;
    $('attentionParentDone').hidden=state.kind!=='sentence'||state.run.heard;
    dialog.showModal();
  }
  function showSentence(){
    if(!active||!session)return;
    const run=session;run.assisted=true;
    openDialog('原句小纸条','<p class="attention-sentence">'+escape(run.card.sentence)+'</p><p>请家长完整读一遍，再收起原句，让孩子想一想。</p>',{kind:'sentence',run});
  }
  $('attentionLevel').innerHTML=data.levels.map(item=>'<option value="'+item.id+'">'+escape(item.label)+'</option>').join('');
  $('attentionIllustration').innerHTML=$('homeAttentionArt').innerHTML;
  $('attentionLevel').addEventListener('change',()=>{const value=Number($('attentionLevel').value);if(!data.levels.some(item=>item.id===value)||value===level)return;level=value;save();nextCard();});
  $('attentionPlay').addEventListener('click',()=>play('sentence'));
  $('attentionReadQuestion').addEventListener('click',()=>play('question'));
  $('attentionStop').addEventListener('click',()=>halt());
  $('attentionNextCard').addEventListener('click',nextCard);
  $('attentionContinue').addEventListener('click',advance);
  $('attentionOptions').addEventListener('click',event=>{const button=event.target.closest('[data-attention-choice]');if(button&&!button.disabled)choose(Number(button.dataset.attentionChoice));});
  $('attentionParent').addEventListener('click',showSentence);
  $('attentionDialogClose').addEventListener('click',()=>closeDialog());
  $('attentionParentDone').addEventListener('click',()=>{
    if(!active||dialogState?.kind!=='sentence'||dialogState.run!==session)return;
    session.heard=true;closeDialog();render();prepare();feedback('家长读完啦，收起原句后就可以开始答题。');
  });
  $('attentionHelp').addEventListener('click',()=>openDialog('听觉训练卡怎么玩','<p>先听一句完整的话，记住里面的人物、地点和发生的事情。</p><p>听完后点“开始答题”，每次回答一个问题，从三个选项中选一个。点“听题”可以听问题和全部选项；也可以重听原句。</p><p>起步每卡 3 问，进阶 4 问，挑战 5 问，每档 8 张。完成后一起看原句和答案，答错了也可以再练。</p><p>需要帮助时点“原句提示 / 家长读题”。先读完，再收起原句回答。发音人和语速沿用首页设置。</p><p>完成记录和每张卡的最好成绩保存在这台设备。练习不用录音，也不限制答题时间。</p>',{kind:'help'}));
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('close',()=>{if(!dialog.open&&dialogState){dialogState=null;returnFocus=null;}});
  window.addEventListener('learningmodechange',event=>{
    if(event.detail.mode!=='attention'){active=false;halt(true);closeDialog(false);return;}
    active=true;if(!session)nextCard();else{render();prepare();}
  });
  window.AttentionCards=Object.freeze({back:()=>{if(!dialog.open)return false;closeDialog();return true;}});
})();
