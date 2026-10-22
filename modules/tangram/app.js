(()=>{
  'use strict';
  const $=id=>document.getElementById(id),g=window.TangramGeometry,data=window.TangramLessons,key='tongqu-tangram-v1',levels=new Map(data.levels.map(l=>[l.id,l]));
  const NS='http://www.w3.org/2000/svg',copy=v=>JSON.parse(JSON.stringify(v)),escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active=false,view='menu',difficulty=1,records={},works=Array(6).fill(null),pending=null,run=null,history=[],drag=null,storageFailed=false,returnFocus=null,dialogAction=null;
  const sameType=(a,b)=>a===b||a<2&&b<2||[3,4].includes(a)&&[3,4].includes(b);
  function validPieces(p){return Array.isArray(p)&&p.length===7&&p.every((v,i)=>v&&v.id===i&&Number.isFinite(v.x)&&v.x>=-150&&v.x<=750&&Number.isFinite(v.y)&&v.y>=-150&&v.y<=650&&Number.isFinite(v.angle)&&v.angle>=0&&v.angle<360&&v.angle%45===0&&typeof v.flip==='boolean'&&typeof v.onBoard==='boolean');}
  function validRun(v){return v&&(v.kind==='level'&&levels.has(v.levelId)||v.kind==='free')&&validPieces(v.pieces)&&Number.isInteger(v.selected)&&v.selected>=0&&v.selected<7&&typeof v.assisted==='boolean'&&typeof v.reference==='boolean';}
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if([1,2,3].includes(saved?.difficulty))difficulty=saved.difficulty;
    for(const [id,r] of Object.entries(saved?.records||{}))if(levels.has(id)&&r?.completed===true)records[id]={completed:true,independent:r.independent===true};
    if(Array.isArray(saved?.works))for(let i=0;i<6;i++){const w=saved.works[i];if(w&&typeof w.name==='string'&&w.name.length<=24&&validPieces(w.pieces))works[i]={name:w.name,pieces:w.pieces};}
    if(validRun(saved?.pending))pending=saved.pending;
  }catch(_){storageFailed=true;}
  function storageNotice(){const text=storageFailed?'这次记录暂时无法保存，仍然可以继续拼。':'';$('tgStorageMenu').textContent=text;$('tgStoragePlay').textContent=text;}
  function persist(){if(run&&view==='play'&&run.kind!=='tutorial')pending=run.completed?null:copy(run);try{localStorage.setItem(key,JSON.stringify({difficulty,records,works,pending}));storageFailed=false;}catch(_){storageFailed=true;}storageNotice();}
  function status(text,tone='normal'){$('tgStatus').textContent=text;$('tgStatus').dataset.tone=tone;}
  function smallArt(polys,colored=true,palette=g.colors){const b=g.bounds(polys),w=b.maxX-b.minX,h=b.maxY-b.minY;return '<svg viewBox="'+[b.minX-8,b.minY-8,w+16,h+16].join(' ')+'" aria-hidden="true">'+polys.map((p,i)=>'<polygon points="'+p.map(v=>v.join(',')).join(' ')+'" fill="'+(colored?palette[i]:'#a3b69b')+'"'+(colored?' stroke="#fffdf6" stroke-width="1.7"':'')+'/>').join('')+'</svg>';}
  function menu(){
    view='menu';$('tangramScreen').dataset.view=view;$('tgMenu').hidden=false;$('tgPlay').hidden=true;
    const total=Object.values(records).filter(r=>r.completed).length;$('tgTotalStars').textContent='★ '+total+' / 24';
    document.querySelectorAll('[data-tg-difficulty]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.tgDifficulty)===difficulty)));
    $('tgDifficultyNote').textContent=['看分割线找位置，前几关会先放好几块。','看外形自己拼，需要时点“看参考”或“一点提示”。','只看影子想一想，提示随时可以用，不用赶时间。'][difficulty-1];
    $('tgLevels').innerHTML=data.levels.filter(l=>l.difficulty===difficulty).map(l=>{const r=records[l.id],f=g.fit(l.polygons);return '<button type="button" class="tg-level-card" data-tg-level="'+l.id+'">'+smallArt(f.target,difficulty===1)+'<span class="tg-card-title">'+escape(l.name)+'<span class="tg-star '+(r?'is-earned':'')+'" aria-label="'+(r?'已完成':'未完成')+'">'+(r?'★':'☆')+'</span></span><small>'+ (r?.independent?'自己拼好啦':r?'已经拼好啦':'第 '+Number(l.id.slice(-2))+' 关')+'</small></button>';}).join('');
    $('tgResume').hidden=!pending;if(pending)$('tgResume').textContent='继续上次的'+(pending.kind==='free'?'自由创作':levels.get(pending.levelId).name)+' →';storageNotice();
  }
  function target(){return g.fit((levels.get(run.levelId)||data.levels[0]).polygons);}
  function tray(){return Array.from({length:7},(_,id)=>({id,x:48+id*84,y:425,angle:0,flip:false,onBoard:false}));}
  function stageTutorial(step){
    const f=g.fit(data.levels[0].polygons),ids=[3,2,6],id=ids[step],pieces=f.target.map((p,i)=>({...g.poseFor(i,p,f.scale),onBoard:true}));
    if(step===0)pieces[id]=tray()[id];else if(step===1)pieces[id].angle=(pieces[id].angle+45)%360;else pieces[id].flip=!pieces[id].flip;
    run={kind:'tutorial',levelId:data.levels[0].id,step,pieces,selected:id,assisted:false,reference:false,hint:null,completed:false};history=[];playView();status(['第一步：把选中的小三角形移到空着的轮廓里。','第二步：选中中三角，点“左转”或“右转”，让它和轮廓一致。','第三步：选中平行四边形，点“翻一翻”，再转到合适方向。'][step]);
  }
  function startLevel(id){
    stopVoice();const l=levels.get(id);if(!l)return;
    if(pending?.kind==='level'&&pending.levelId===id){run=copy(pending);run.hint=null;history=[];playView();status('继续上次的小发现，选一块板试试看。');return;}
    const f=g.fit(l.polygons),pieces=tray();for(let i=0;i<l.prefill;i++)pieces[i]={...g.poseFor(i,f.target[i],f.scale),onBoard:true};
    run={kind:'level',levelId:id,pieces,selected:Math.min(l.prefill,6),assisted:l.prefill>0,reference:false,hint:null,completed:false};history=[];playView();persist();status(l.prefill?'已经放好几块啦，把剩下的小板移到轮廓里。':'把七块板移到上面，用它们拼出'+l.name+'。');
  }
  function startFree(work,slot=null){stopVoice();run={kind:'free',levelId:null,workSlot:slot,pieces:work?copy(work.pieces):tray(),selected:0,assisted:false,reference:false,hint:null,completed:false};history=[];playView();persist();status('用七块板自由拼一拼，完成后可以给作品起名字。');}
  function playView(){view='play';$('tangramScreen').dataset.view=view;$('tgMenu').hidden=true;$('tgPlay').hidden=false;$('tgToMenu').textContent=run.kind==='tutorial'?'跳过教学':'回关卡';$('tgPuzzleTitle').textContent=run.kind==='free'?'自由创作':run.kind==='tutorial'?['移一移 · 1 / 3','转一转 · 2 / 3','翻一翻 · 3 / 3'][run.step]:levels.get(run.levelId).name;render();}
  function scale(){return run.kind==='free'?38:target().scale;}
  function polygon(p){return g.polygon(p,scale()*(p.onBoard?1:.48));}
  function svg(name,attrs){const e=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
  function render(){
    if(!run)return;const free=run.kind==='free',f=target();
    const showLines=!free&&(run.kind==='tutorial'||levels.get(run.levelId).difficulty===1),targetNode=$('tgTarget');targetNode.replaceChildren();
    if(!free){for(const p of f.target)targetNode.append(svg('polygon',{points:p.map(v=>v.join(',')).join(' '),class:'tg-target-fill'}));
      const lines=showLines?f.target.flatMap(p=>p.map((a,i)=>[a,p[(i+1)%p.length]])):g.outline(f.target);
      targetNode.append(svg('path',{d:lines.map(([a,b])=>'M'+a.join(' ')+'L'+b.join(' ')).join(' '),class:'tg-target-outline'}));
    }
    $('tgHintShape').replaceChildren();if(run.hint?.tier>=2)$('tgHintShape').append(svg('polygon',{points:f.target[run.hint.target].map(v=>v.join(',')).join(' '),class:'tg-hint-poly'}));
    const nodes=$('tgPieces');nodes.replaceChildren();const sorted=[...run.pieces.filter(p=>p.id!==run.selected),run.pieces[run.selected]].filter(p=>p.onBoard);
    for(const p of sorted){const points=polygon(p).map(v=>v.join(',')).join(' '),group=svg('g',{'data-tg-piece':p.id,class:'tg-piece'+(p.id===run.selected?' is-selected':''),role:'button',tabindex:'-1','aria-label':g.labels[p.id]+'，'+(p.onBoard?'已在拼板':'还在小板区')});group.append(svg('polygon',{points,class:'tg-piece-hit'}),svg('polygon',{points,fill:g.colors[p.id],class:'tg-piece-face'}));nodes.append(group);}
    $('tgTray').querySelectorAll('[data-tg-tray]').forEach(button=>{const p=run.pieces[Number(button.dataset.tgTray)];button.setAttribute('aria-pressed',String(p.id===run.selected));button.classList.toggle('is-placed',p.onBoard);button.setAttribute('aria-label',g.labels[p.id]+(p.onBoard?'，已在拼板，点击选中':'，拖进拼板'));button.querySelector('svg').innerHTML='<polygon points="'+g.polygon({...p,x:0,y:0},7).map(v=>v.join(',')).join(' ')+'" fill="'+g.colors[p.id]+'"/>';});
    $('tgSelection').textContent=g.labels[run.selected]+' · 拖进拼板，每次转 45°';
    $('tgFlip').disabled=run.selected!==6;$('tgUndo').disabled=!history.length;
    $('tgHint').hidden=free;$('tgReferenceToggle').hidden=free||run.kind==='tutorial';$('tgReferenceToggle').textContent=run.reference?'收起参考':'看参考';
    $('tgHelpPlace').hidden=free||!run.hint||run.hint.tier<2;$('tgSaveWork').hidden=!free;
    $('tgReference').hidden=!run.reference||free;$('tgReference').innerHTML=run.reference?smallArt(f.target):'';storageNotice();
  }
  function push(){history.push(copy(run));if(history.length>60)history.shift();}
  function select(id){if(!run||!Number.isInteger(id)||id<0||id>6)return;run.selected=id;render();}
  function boardPoint(event){const pt=$('tgBoard').createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;return pt.matrixTransform($('tgBoard').getScreenCTM().inverse());}
  function within(p){const poly=g.polygon(p,scale());return poly.every(v=>v[0]>=2&&v[0]<=598&&v[1]>=2&&v[1]<=448);}
  function clampBoard(p){const b=g.bounds([g.polygon(p,scale())]);p.x+=Math.max(0,3-b.minX)-Math.max(0,b.maxX-597);p.y+=Math.max(0,3-b.minY)-Math.max(0,b.maxY-447);}
  function snap(p){
    if(run.kind==='free'||!p.onBoard)return;const f=target(),threshold=run.kind==='tutorial'?28:[27,22,18][levels.get(run.levelId).difficulty-1];
    const possible=f.target.map((poly,i)=>({poly,i})).filter(t=>sameType(p.id,t.i)).map(t=>{const pose=g.poseFor(p.id,t.poly,f.scale),dist=Math.hypot(p.x-pose.x,p.y-pose.y),centered={...p,x:pose.x,y:pose.y};return {...t,pose,dist,match:g.overlap(g.polygon(centered,f.scale),t.poly)/g.area(t.poly)};}).filter(t=>t.dist<threshold&&t.match>.999).sort((a,b)=>a.dist-b.dist);
    if(possible.length){const best=possible[0];if(run.pieces.some(other=>other.id!==p.id&&other.onBoard&&g.overlap(g.polygon(other,f.scale),best.poly)>.1))return;Object.assign(p,best.pose);p.onBoard=true;}
  }
  function transformed(action){if(!active||view!=='play'||drag||$('tgDialog').open)return;push();const p=run.pieces[run.selected];action(p);if(p.onBoard){clampBoard(p);snap(p);}run.hint=null;run.completed=false;render();persist();evaluate();}
  function evaluate(){
    if(run.kind==='free'){const placed=run.pieces.filter(p=>p.onBoard),polys=placed.map(p=>g.polygon(p,scale()));let overlap=0;for(let i=0;i<polys.length;i++)for(let j=0;j<i;j++)overlap+=g.overlap(polys[i],polys[j]);
      status(placed.length===7&&overlap<.1&&placed.every(within)?'七块都用上啦！这是一幅标准七巧板作品，可以保存。':'自由探索中，草稿也能保存。'+(overlap>.1?'有些板块重叠了，移一移看看。':'还可以继续摆放小板块。'));return;
    }
    const placed=run.pieces.filter(p=>p.onBoard),m=g.metrics(placed,target().target,scale());
    if(m.complete){if(run.completed)return;run.completed=true;stopVoice();
      if(run.kind==='level'){const old=records[run.levelId];records[run.levelId]={completed:true,independent:old?.independent===true||!run.assisted};persist();}
      status('七块拼好啦！','success');completion();
    }else{const count=correctTargets().length;status(m.duplicate>scale()*scale()*.08?'有些板块重叠了，移开一点再看看。':'已经放好 '+count+' / 7 块。'+(run.kind==='tutorial'?'试试这一步的小动作。':'选一块，转一转，再移一移。'));}
  }
  function correctTargets(){const f=target(),used=new Set(),filled=[];for(let i=0;i<7;i++){const p=run.pieces.find(p=>!used.has(p.id)&&p.onBoard&&sameType(p.id,i)&&g.overlap(g.polygon(p,f.scale),f.target[i])>g.area(f.target[i])*.998);if(p){used.add(p.id);filled.push(i);}}return filled;}
  function nextHint(){if(!run||run.kind==='free'||drag)return;run.assisted=true;
    if(!run.hint){const filled=correctTargets(),t=Array.from({length:7},(_,i)=>i).find(i=>!filled.includes(i));if(t===undefined){evaluate();return;}const f=target(),id=run.pieces.find(p=>sameType(p.id,t)&&!f.target.some((poly,i)=>filled.includes(i)&&g.overlap(g.polygon(p,f.scale),poly)>g.area(poly)*.998))?.id??t;run.hint={target:t,piece:id,tier:1};}
    else run.hint.tier=Math.min(2,run.hint.tier+1);
    run.selected=run.hint.piece;render();persist();const c=g.center(target().target[run.hint.target]);status(run.hint.tier===1?'试试'+g.labels[run.hint.piece]+'，看看图形'+(c[0]<280?'左边':c[0]>320?'右边':'中间')+'的位置。再点提示可以看这一块的轮廓。':'黄色虚线就是这块的位置。可以自己试，也可以点“帮我放这块”。');
  }
  function helpPlace(){if(!run.hint||drag)return;push();const h=run.hint,f=target(),p=run.pieces[h.piece];Object.assign(p,g.poseFor(p.id,f.target[h.target],f.scale),{onBoard:true});run.assisted=true;run.hint=null;render();persist();evaluate();}
  function stopVoice(){window.ListeningAudio?.stop();}
  function speak(){if(!run||!active)return;const text=run.kind==='free'?'用七块板自由拼一拼。选中小板，可以左转、右转。平行四边形还可以翻一翻。':run.kind==='tutorial'?['把小三角形移到空着的轮廓里。','选中中三角，点左转或右转。','选中平行四边形，点翻一翻，再转到合适方向。'][run.step]:'用七块板，拼出'+levels.get(run.levelId).name+'。选一块，移一移、转一转。';window.ListeningAudio?.play([text],{onerror:message=>{if(active&&view==='play')status(message);}});}
  function closeDialog(restore=true){if(!$('tgDialog').open)return;const focus=returnFocus;dialogAction=null;returnFocus=null;$('tgDialog').close();if(restore&&focus?.isConnected&&focus.getClientRects().length)focus.focus({preventScroll:true});}
  function dialog(title,body,actions=[]){stopVoice();cancelDrag();closeDialog(false);returnFocus=document.activeElement;$('tgDialogTitle').textContent=title;$('tgDialogBody').innerHTML=body;$('tgDialogActions').replaceChildren();dialogAction=actions;actions.forEach((a,i)=>{const b=document.createElement('button');b.type='button';b.className='tg-button'+(a.primary?' tg-primary':'');b.textContent=a.label;b.dataset.tgDialogAction=String(i);$('tgDialogActions').append(b);});$('tgDialog').showModal();}
  function completion(){
    const f=target();if(run.kind==='tutorial'){dialog('这一步学会啦！','<div class="tg-success-star" aria-hidden="true">★</div><p>'+['小板移到轮廓里啦。接下来试试旋转。','转一转，形状就对上啦。接下来认识翻面。','现在你会移动、旋转和翻面啦，一起去拼图吧。'][run.step]+'</p>',[{label:run.step<2?'下一步':'去拼图',primary:true,action:()=>{const step=run.step;closeDialog(false);if(step<2)stageTutorial(step+1);else{run=null;menu();persist();}}}]);return;}
    dialog(levels.get(run.levelId).name+'拼好啦！','<span class="tg-success-star" aria-label="获得完成星星">★</span><div class="tg-success-art">'+smallArt(f.target)+'</div><p>'+ (run.assisted?'观察、尝试，一样值得一颗星星！':'你自己用七块板拼好啦！')+'</p>',[{label:'回关卡',action:()=>{closeDialog(false);menu();}},{label:'再拼一次',action:()=>{const id=run.levelId;closeDialog(false);pending=null;startLevel(id);}},{label:'下一关',primary:true,action:()=>{const i=data.levels.findIndex(l=>l.id===run.levelId);closeDialog(false);if(i===23){menu();return;}pending=null;difficulty=data.levels[i+1].difficulty;startLevel(data.levels[i+1].id);}}]);
  }
  function saveWork(){
    const first=works.findIndex(w=>!w),slot=Number.isInteger(run.workSlot)&&works[run.workSlot]?run.workSlot:first<0?0:first;
    dialog('保存我的作品','<p>你拼的是什么？给它起个名字，讲一个小故事吧。</p><label for="tgWorkName">作品名称（最多 24 字）</label><input id="tgWorkName" maxlength="24" value="'+escape(works[run.workSlot]?.name||'我的七巧板')+'" autocomplete="off"><label for="tgWorkSlot">保存位置</label><select id="tgWorkSlot">'+works.map((w,i)=>'<option value="'+i+'"'+(i===slot?' selected':'')+'>'+String(i+1)+' · '+escape(w?.name||'空位置')+'</option>').join('')+'</select><p id="tgSaveError" role="status"></p>',[{label:'保存',primary:true,action:()=>{const slot=Number($('tgWorkSlot').value),name=$('tgWorkName').value.trim().slice(0,24)||'我的七巧板';
      const write=()=>{const old=works[slot],oldSlot=run.workSlot;works[slot]={name,pieces:copy(run.pieces)};run.workSlot=slot;persist();if(storageFailed){works[slot]=old;run.workSlot=oldSlot;$('tgSaveError').textContent='这次没能保存作品，继续拼也没有关系。';return;}closeDialog();status('“'+name+'”已保存在我的作品，可以随时回来编辑。','success');};
      if(works[slot]){dialog('覆盖这幅作品？','<p>将用“'+escape(name)+'”替换位置 '+(slot+1)+' 的“'+escape(works[slot].name)+'”。</p><p id="tgSaveError" role="status"></p>',[{label:'取消',action:()=>closeDialog()},{label:'确认覆盖',primary:true,action:write}]);}else write();
    }}]);
  }
  function gallery(){dialog('我的作品','<p>作品保存在这台设备，点一幅可以继续创作。</p><div class="tg-work-grid">'+works.map((w,i)=>{if(!w)return '<div class="tg-work-card"><span>位置 '+(i+1)+' · 还没有作品</span></div>';const placed=w.pieces.filter(p=>p.onBoard);return '<button type="button" class="tg-work-card" data-tg-work="'+i+'">'+(placed.length?smallArt(placed.map(p=>g.polygon(p,38)),true,placed.map(p=>g.colors[p.id])):'<p>还在构思的小草稿</p>')+'<span>'+escape(w.name)+'</span></button>';}).join('')+'</div>');}
  function cancelDrag(){if(!drag)return;const d=drag;drag=null;run.pieces[d.id]=d.before;try{$('tgBoard').releasePointerCapture(d.pointer);}catch(_){}render();}
  function beginDrag(event,fromTray=false){
    if(!active||view!=='play'||$('tgDialog').open||drag||event.button>0)return;
    const hit=event.target.closest(fromTray?'[data-tg-tray]':'[data-tg-piece]');if(!hit)return;
    const point=boardPoint(event);let id=Number(fromTray?hit.dataset.tgTray:hit.dataset.tgPiece);
    // Actual faces take priority over the larger invisible touch targets.
    if(!fromTray){const order=[run.pieces[run.selected],...run.pieces.filter(p=>p.id!==run.selected).reverse()];const face=order.find(p=>p.onBoard&&g.polygon(p,scale()).every((a,i,poly)=>{const b=poly[(i+1)%poly.length];return (b[0]-a[0])*(point.y-a[1])-(b[1]-a[1])*(point.x-a[0])>=-1e-6;}));if(face)id=face.id;}
    event.preventDefault();const p=run.pieces[id];run.selected=id;
    drag={id,pointer:event.pointerId,before:copy(p),start:{x:event.clientX,y:event.clientY},offset:fromTray?{x:0,y:0}:{x:point.x-p.x,y:point.y-p.y},moved:false};$('tgBoard').setPointerCapture(event.pointerId);render();
  }
  $('tgBoard').addEventListener('pointerdown',event=>beginDrag(event));
  $('tgTray').addEventListener('pointerdown',event=>beginDrag(event,true));
  $('tgBoard').addEventListener('pointermove',event=>{if(!drag||drag.pointer!==event.pointerId)return;event.preventDefault();if(!drag.moved&&Math.hypot(event.clientX-drag.start.x,event.clientY-drag.start.y)<4)return;const point=boardPoint(event),p=run.pieces[drag.id];p.x=Math.max(-40,Math.min(640,point.x-drag.offset.x));p.y=Math.max(-40,Math.min(520,point.y-drag.offset.y));p.onBoard=point.x>=0&&point.x<=600&&point.y>=0&&point.y<=450;drag.moved=true;render();});
  $('tgBoard').addEventListener('pointerup',event=>{if(!drag||drag.pointer!==event.pointerId)return;event.preventDefault();const d=drag,p=run.pieces[d.id];drag=null;try{$('tgBoard').releasePointerCapture(event.pointerId);}catch(_){}
    if(d.moved){const old=copy(run);old.pieces[d.id]=d.before;history.push(old);if(history.length>60)history.shift();if(p.onBoard){clampBoard(p);snap(p);}else Object.assign(p,{x:48+p.id*84,y:425,onBoard:false});run.hint=null;run.completed=false;}
    render();persist();if(d.moved)evaluate();});
  $('tgBoard').addEventListener('pointercancel',cancelDrag);$('tgBoard').addEventListener('lostpointercapture',()=>{if(drag)cancelDrag();});
  $('tgBoard').addEventListener('keydown',event=>{if(!run||$('tgDialog').open)return;const deltas={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]};if(deltas[event.key]){event.preventDefault();transformed(p=>{const d=deltas[event.key];if(!p.onBoard){p.x=300;p.y=180;p.onBoard=true;}else{p.x+=d[0]*(event.shiftKey?3:1);p.y+=d[1]*(event.shiftKey?3:1);}});}});
  $('tgTray').innerHTML=g.labels.map((s,i)=>'<button type="button" data-tg-tray="'+i+'" aria-label="'+s+'" aria-pressed="false"><svg viewBox="-23 -23 46 46" aria-hidden="true"></svg><span>'+['大','大','中','小','小','方','斜'][i]+'</span></button>').join('');
  $('tgTray').addEventListener('click',event=>{const button=event.target.closest('[data-tg-tray]');if(button&&!drag){select(Number(button.dataset.tgTray));persist();}});
  $('tgRotateLeft').addEventListener('click',()=>transformed(p=>p.angle=(p.angle+315)%360));$('tgRotateRight').addEventListener('click',()=>transformed(p=>p.angle=(p.angle+45)%360));$('tgFlip').addEventListener('click',()=>{if(run.selected===6)transformed(p=>p.flip=!p.flip);});
  $('tgUndo').addEventListener('click',()=>{if(!history.length||drag)return;const assisted=run.assisted;run=history.pop();run.assisted=run.assisted||assisted;run.completed=false;render();persist();status('回到上一步啦，可以换个想法再试试。');});
  $('tgReset').addEventListener('click',()=>dialog('重新开始这幅拼图？','<p>小板会回到开始的位置。已经获得的星星和保存的作品继续保留。</p>',[{label:'继续拼',action:()=>closeDialog()},{label:'重新开始',primary:true,action:()=>{const r=run;closeDialog(false);if(r.kind==='tutorial')stageTutorial(r.step);else if(r.kind==='free')startFree();else{pending=null;startLevel(r.levelId);}}}]));
  $('tgHint').addEventListener('click',nextHint);$('tgHelpPlace').addEventListener('click',helpPlace);$('tgSpeak').addEventListener('click',speak);
  $('tgReferenceToggle').addEventListener('click',()=>{run.reference=!run.reference;if(run.reference)run.assisted=true;render();persist();});
  $('tgToMenu').addEventListener('click',()=>{cancelDrag();stopVoice();persist();menu();});$('tgResume').addEventListener('click',()=>{if(!pending)return;run=copy(pending);run.hint=null;history=[];playView();status('继续上次的拼图，慢慢来。');});
  $('tgTutorial').addEventListener('click',()=>stageTutorial(0));$('tgFree').addEventListener('click',()=>startFree());$('tgWorks').addEventListener('click',gallery);$('tgSaveWork').addEventListener('click',saveWork);
  $('tgLevels').addEventListener('click',e=>{const b=e.target.closest('[data-tg-level]');if(b)startLevel(b.dataset.tgLevel);});
  document.querySelectorAll('[data-tg-difficulty]').forEach(b=>b.addEventListener('click',()=>{difficulty=Number(b.dataset.tgDifficulty);persist();menu();}));
  $('tgHelp').addEventListener('click',()=>dialog('七巧板怎么玩','<p>七巧板有两个大三角形、一个中三角形、两个小三角形、一个正方形和一个平行四边形。大小固定，七块能拼出很多图形。</p><p>先选一块，再拖到拼板。点“左转”“右转”，每次转 45°；选中平行四边形可以“翻一翻”。靠近正确位置会轻轻吸附。</p><p>正式拼图要用完七块，小板不能重叠。跟着拼有分割线；自己拼与挑战拼看外轮廓，不同的有效拼法也算完成。</p><p>需要帮助可以看参考，或点“一点提示”：先给方向，再给一块轮廓，最后可以帮你放这一块。提示也能获得星星。</p><p>自由创作没有标准答案，草稿也能保存，六个作品位都可以再打开编辑。记录保存在当前设备。</p><p>键盘也能玩：点下方小板选中板块，拼板获得焦点后用方向键移动，按住 Shift 可移动大一点。没有倒计时，慢慢拼。</p>'));
  $('tgDialogClose').addEventListener('click',()=>closeDialog());$('tgDialogActions').addEventListener('click',e=>{const b=e.target.closest('[data-tg-dialog-action]');if(b)dialogAction?.[Number(b.dataset.tgDialogAction)]?.action();});
  $('tgDialogBody').addEventListener('click',e=>{const b=e.target.closest('[data-tg-work]');if(b){const slot=Number(b.dataset.tgWork),w=works[slot];closeDialog(false);startFree(w,slot);}});
  $('tgDialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
  window.addEventListener('learningmodechange',e=>{if(e.detail.mode!=='tangram'){if(active){cancelDrag();persist();closeDialog(false);}active=false;return;}active=true;if(view==='play'&&run)playView();else menu();});
  window.addEventListener('pagehide',()=>{cancelDrag();persist();});document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelDrag();if(active)persist();}});window.addEventListener('resize',cancelDrag);
  window.TangramGame=Object.freeze({back:()=>{if($('tgDialog').open){closeDialog();return true;}if(view==='play'){cancelDrag();stopVoice();persist();menu();return true;}return false;}});
  $('tgWelcomeArt').innerHTML=$('homeTangramArt').innerHTML;menu();
})();
