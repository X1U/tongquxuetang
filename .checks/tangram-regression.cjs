'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),g=require('../modules/tangram/geometry.js'),data=require('../scripts/build-tangram.cjs').lessons();
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'tangram-1.22'),key='tongqu-tangram-v1';
const report={completed:false,checks:[],levels:[],viewports:[],errors:[],speech:'模拟 Android 语音桥，验证调用和取消；不代表真机试听'};
fs.mkdirSync(out,{recursive:true});
const clone=v=>JSON.parse(JSON.stringify(v));
function geometryChecks(){
  for(const l of data.levels){
    const f=g.fit(l.polygons),pieces=f.target.map((p,i)=>({...g.poseFor(i,p,f.scale),onBoard:true}));
    assert.ok(g.metrics(pieces,f.target,f.scale).complete,l.name);
    const swapped=clone(pieces);[swapped[0],swapped[1]]=[{...pieces[1],id:0},{...pieces[0],id:1}];[swapped[3],swapped[4]]=[{...pieces[4],id:3},{...pieces[3],id:4}];
    assert.ok(g.metrics(swapped,f.target,f.scale).complete,'Equal triangles are interchangeable');
    assert.ok(!g.metrics(pieces.slice(1),f.target,f.scale).complete,'Missing piece');
    const duplicated=clone(pieces);duplicated[1]={...pieces[0],id:1};assert.ok(!g.metrics(duplicated,f.target,f.scale).complete,'Overlapping triangles');
    const outside=clone(pieces);outside[6].x+=30;assert.ok(!g.metrics(outside,f.target,f.scale).complete,'Obvious gap / outside');
    const flipped=clone(pieces);flipped[6].flip=!flipped[6].flip;assert.ok(!g.metrics(flipped,f.target,f.scale).complete,'Wrong parallelogram reflection');
  }
  const f=g.fit(data.levels[0].polygons),pieces=f.target.map((p,i)=>g.poseFor(i,p,f.scale));
  const alternate=pieces.map(p=>({...p,x:300-(p.y-225),y:225+(p.x-300),angle:(p.angle+90)%360}));
  assert.ok(g.metrics(alternate,f.target,f.scale).complete,'Another dissection of the square');
  assert.ok(alternate.some((p,i)=>g.overlap(g.polygon(p,f.scale),f.target[i])<g.area(f.target[i])*.9));
  const tiny=pieces.map(p=>({...p,x:p.x+.02,y:p.y-.02}));assert.ok(g.metrics(tiny,f.target,f.scale).complete,'Floating point / subpixel tolerance');
  report.checks.push('24 standard connected layouts; equal triangle swaps; missing, overlap, outside and reflection rejection; alternative dissection and subpixel tolerance');
}
function nativeFixture(){
  window.__speech=[];window.__stops=0;
  window.AndroidTts={isReady:()=>true,listVoices:()=>JSON.stringify([{id:'test-zh',name:'测试中文',lang:'zh-CN',local:true}]),setVoice(){},
    speakWithId(text,rate,id){window.__speech.push({text,rate,id});window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}}));},stop(){window.__stops++;},prepare(){},cancelPreparation(){},installChineseVoice(){}};
  if(!localStorage.getItem('tongqu-global-voice-v1'))localStorage.setItem('tongqu-global-voice-v1',JSON.stringify({voiceId:'test-zh',rate:.78}));
  if(!localStorage.getItem('tongqu-listening-v1'))localStorage.setItem('tongqu-listening-v1',JSON.stringify({prefs:{level:2},progress:{sound:7,train:5}}));
}
const saved=p=>p.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
async function mode(p,value){await p.evaluate(v=>location.hash=v,value);await p.waitForFunction(v=>document.body.dataset.mode===v,value);}
async function point(p,x,y){return p.locator('#tgBoard').evaluate((svg,{x,y})=>{const pt=svg.createSVGPoint();pt.x=x;pt.y=y;const q=pt.matrixTransform(svg.getScreenCTM());return {x:q.x,y:q.y};},{x,y});}
async function dragPiece(p,id,x,y,source){
  const start=source?await point(p,source.x,source.y):await p.locator('[data-tg-tray="'+id+'"]').boundingBox().then(b=>({x:b.x+b.width/2,y:b.y+b.height/2}));
  const end=await point(p,x,y);await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(end.x,end.y,{steps:5});await p.mouse.up();
}
async function orient(p,id,pose){
  await p.locator('[data-tg-tray="'+id+'"]').click();
  let piece=(await saved(p)).pending.pieces[id];
  if(piece.flip!==pose.flip&&id===6){await p.locator('#tgFlip').click();piece=(await saved(p)).pending.pieces[id];}
  let delta=(pose.angle-piece.angle+360)%360,selector=delta>180?'#tgRotateLeft':'#tgRotateRight',turns=(delta>180?360-delta:delta)/45;
  for(let i=0;i<turns;i++)await p.locator(selector).click();
}
async function seed(p,pending){
  // pagehide saves the running game; install a one-shot fixture on the next load.
  await p.evaluate(pending=>sessionStorage.setItem('test-next-tangram',JSON.stringify(pending)),pending);
  await p.addInitScript(key=>{const pending=sessionStorage.getItem('test-next-tangram');if(!pending)return;sessionStorage.removeItem('test-next-tangram');const state=JSON.parse(localStorage.getItem(key))||{records:{},works:[]};state.pending=JSON.parse(pending);localStorage.setItem(key,JSON.stringify(state));},key);
  await p.reload();await p.locator('#tgResume').click();
}
async function assistedPiece(p){await p.locator('#tgHint').click();assert.ok(await p.locator('#tgHelpPlace').isHidden());await p.locator('#tgHint').click();await p.locator('#tgHelpPlace').click();}
async function main(){
  geometryChecks();console.log('Geometry checks passed');
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{"available":false}');return;}res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const base='http://127.0.0.1:'+server.address().port;
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});await context.addInitScript(nativeFixture);
    const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>report.errors.push(e.message));await p.goto(base+'/#tangram');
    const legacy=await p.evaluate(()=>localStorage.getItem('tongqu-listening-v1'));
    assert.equal(await p.locator('[data-open-mode]').count(),10);assert.equal(await p.locator('[data-tg-level]').count(),8);
    // Three tutorials, driven by actual pointer and rotation controls.
    await p.locator('#tgTutorial').click();let f=g.fit(data.levels[0].polygons),pose=g.poseFor(3,f.target[3],f.scale);
    await dragPiece(p,3,pose.x+4,pose.y+4);assert.match(await p.locator('#tgDialogTitle').textContent(),/学会/);
    await p.getByRole('button',{name:'下一步',exact:true}).click();await p.locator('#tgRotateLeft').click();assert.match(await p.locator('#tgDialogTitle').textContent(),/学会/);
    await p.getByRole('button',{name:'下一步',exact:true}).click();await p.locator('#tgFlip').click();assert.match(await p.locator('#tgDialogTitle').textContent(),/学会/);await p.getByRole('button',{name:'去拼图',exact:true}).click();
    report.checks.push('All three tutorials completed via pointer drag, 45-degree rotation and parallelogram flip');console.log('Tutorials passed');
    // All levels solved with real drag controls; both kinds of duplicate triangles are swapped.
    for(const level of data.levels){
      await p.locator('[data-tg-difficulty="'+level.difficulty+'"]').click();await p.locator('[data-tg-level="'+level.id+'"]').click();f=g.fit(level.polygons);
      for(let id=0;id<7;id++){
        if((await saved(p)).pending?.pieces[id].onBoard)continue;
        const destination=level.prefill? id:({0:1,1:0,3:4,4:3}[id]??id),pose=g.poseFor(id,f.target[destination],f.scale);
        await orient(p,id,pose);await dragPiece(p,id,pose.x+3,pose.y+2);
      }
      assert.match(await p.locator('#tgDialogTitle').textContent(),/拼好啦/);const r=(await saved(p)).records[level.id];assert.ok(r.completed);assert.equal(r.independent,level.prefill===0);
      await p.getByRole('button',{name:'回关卡',exact:true}).last().click();report.levels.push(level.id);console.log('Solved '+level.id+' '+level.name);
    }
    assert.equal(Object.keys((await saved(p)).records).length,24);assert.match(await p.locator('#tgTotalStars').textContent(),/24 \/ 24/);
    report.checks.push('24 levels completed with UI rotations, flips, near-position snaps and triangle swaps; one star per level and independent records');
    // Hints do not move anything until the explicit third action; undo preserves assistance.
    await p.locator('[data-tg-level="tangram-24"]').click();const before=(await saved(p)).pending.pieces;
    await p.locator('#tgHint').click();assert.deepEqual((await saved(p)).pending.pieces,before);assert.equal(await p.locator('.tg-hint-poly').count(),0);
    await p.locator('#tgHint').click();assert.equal(await p.locator('.tg-hint-poly').count(),1);assert.deepEqual((await saved(p)).pending.pieces,before);
    await p.locator('#tgHelpPlace').click();assert.equal((await saved(p)).pending.pieces.filter(v=>v.onBoard).length,1);
    await p.locator('#tgUndo').click();assert.deepEqual((await saved(p)).pending.pieces,before);assert.ok((await saved(p)).pending.assisted);
    await p.locator('#tgReferenceToggle').click();assert.ok(await p.locator('#tgReference').isVisible());await p.locator('#tgToMenu').click();await p.reload();await p.locator('#tgResume').click();assert.ok(await p.locator('#tgReference').isVisible());
    await p.locator('#tgReset').click();await p.getByRole('button',{name:'继续拼',exact:true}).click();assert.ok((await saved(p)).pending.reference);await p.locator('#tgReset').click();await p.getByRole('button',{name:'重新开始',exact:true}).last().click();assert.ok(!(await saved(p)).pending.reference);
    report.checks.push('Three-stage hints, explicit placement, undo, assistance tracking, reference persistence, reset confirmation and resume after reload');
    // A far-away correct orientation must not snap; wrong orientation near target must not snap.
    f=g.fit(data.levels[23].polygons);pose=g.poseFor(0,f.target[0],f.scale);await orient(p,0,pose);await dragPiece(p,0,pose.x+65,pose.y);
    let state=(await saved(p)).pending;assert.ok(Math.hypot(state.pieces[0].x-pose.x,state.pieces[0].y-pose.y)>40);await p.locator('#tgUndo').click();
    await p.locator('#tgRotateRight').click();await dragPiece(p,0,pose.x,pose.y);state=(await saved(p)).pending;assert.ok(g.overlap(g.polygon(state.pieces[0],f.scale),f.target[0])<g.area(f.target[0])*.99);
    await p.locator('#tgUndo').click();
    // Snapshot a drag, cancel it, then check resize and navigation persistence.
    const initial=(await saved(p)).pending;const tray=await p.locator('[data-tg-tray="2"]').boundingBox(),end=await point(p,300,225);
    await p.mouse.move(tray.x+tray.width/2,tray.y+tray.height/2);await p.mouse.down();await p.mouse.move(end.x,end.y);await p.setViewportSize({width:844,height:390});await p.mouse.up();await p.evaluate(()=>TangramGame.back());
    assert.deepEqual((await saved(p)).pending.pieces,initial.pieces);await p.setViewportSize({width:390,height:844});await p.locator('#tgResume').click();
    await dragPiece(p,2,300,225);const positioned=(await saved(p)).pending.pieces;await p.setViewportSize({width:844,height:390});assert.deepEqual((await saved(p)).pending.pieces,positioned);await p.setViewportSize({width:390,height:844});
    report.checks.push('Distance/angle snap limits, cancelled drags, portrait/landscape position stability');
    // Inject a different valid square dissection, finish the last piece with a pointer.
    f=g.fit(data.levels[0].polygons);let alternate=f.target.map((poly,id)=>{const q=g.poseFor(id,poly,f.scale);return {...q,x:300-(q.y-225),y:225+(q.x-300),angle:(q.angle+90)%360,onBoard:true};});pose=clone(alternate[6]);alternate[6]={...pose,x:552,y:425,onBoard:false};
    await seed(p,{kind:'level',levelId:'tangram-01',pieces:alternate,selected:6,assisted:false,reference:false,completed:false});await dragPiece(p,6,pose.x,pose.y);assert.match(await p.locator('#tgDialogTitle').textContent(),/拼好啦/);await p.locator('#tgDialogClose').click();
    // Closing completion and editing must make the puzzle resumable, and allow completing again.
    await p.locator('#tgRotateRight').click();assert.ok((await saved(p)).pending);await p.locator('#tgUndo').click();await p.locator('#tgRotateRight').click();await p.locator('#tgRotateLeft').click();assert.ok(await p.locator('#tgDialog').isVisible());await p.getByRole('button',{name:'回关卡',exact:true}).last().click();
    report.checks.push('Alternative whole-silhouette dissection accepted; completed puzzle can be edited, saved and completed again');
    // Six drafts, overwrite confirmation, escaping and continued editing.
    await p.locator('#tgFree').click();await dragPiece(p,5,250,180);await p.locator('#tgRotateRight').click();const free=(await saved(p)).pending.pieces;
    for(let slot=0;slot<6;slot++){await p.locator('#tgSaveWork').click();await p.locator('#tgWorkName').fill(slot===0?'<小船 & 星星>':'作品 '+(slot+1));await p.locator('#tgWorkSlot').selectOption(String(slot));await p.getByRole('button',{name:'保存',exact:true}).click();}
    assert.equal((await saved(p)).works.filter(Boolean).length,6);await p.locator('#tgToMenu').click();await p.locator('#tgWorks').click();assert.equal(await p.locator('[data-tg-work]').count(),6);assert.equal(await p.locator('[data-tg-work="0"] polygon').getAttribute('fill'),g.colors[5]);await p.locator('[data-tg-work="0"]').click();assert.deepEqual((await saved(p)).pending.pieces,free);
    await p.locator('#tgSaveWork').click();assert.equal(await p.locator('#tgWorkName').inputValue(),'<小船 & 星星>');await p.locator('#tgWorkName').fill('新小船');await p.getByRole('button',{name:'保存',exact:true}).click();await p.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await saved(p)).works[0].name,'<小船 & 星星>');
    await p.locator('#tgSaveWork').click();await p.locator('#tgWorkName').fill('新小船');await p.getByRole('button',{name:'保存',exact:true}).click();await p.getByRole('button',{name:'确认覆盖',exact:true}).click();assert.equal((await saved(p)).works[0].name,'新小船');
    // Storage failing midway never claims a successful save or loses the old work.
    await p.evaluate(()=>{window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('Quota exceeded');};});await p.locator('#tgSaveWork').click();await p.locator('#tgWorkName').fill('不能写入');await p.getByRole('button',{name:'保存',exact:true}).click();await p.getByRole('button',{name:'确认覆盖',exact:true}).click();assert.match(await p.locator('#tgSaveError').textContent(),/没能保存/);await p.locator('#tgDialogClose').click();assert.match(await p.locator('#tgStoragePlay').textContent(),/无法保存/);await p.evaluate(()=>Storage.prototype.setItem=window.__setItem);await p.locator('#tgToMenu').click();assert.equal((await saved(p)).works[0].name,'新小船');
    report.checks.push('Six named drafts, safe name rendering, reopen/edit, cancel/confirm overwrite and failed-save rollback');
    // Native touch events exercise mobile pointer capture and page-scroll prevention.
    await p.locator('#tgFree').click();const cdp=await context.newCDPSession(p),touchStart=await p.locator('[data-tg-tray="4"]').boundingBox(),touchEnd=await point(p,300,225);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchStart.x+touchStart.width/2,y:touchStart.y+touchStart.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touchEnd]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    assert.ok((await saved(p)).pending.pieces[4].onBoard);assert.equal(await p.evaluate(()=>scrollY),0);await p.locator('#tgBoard').focus();const oldX=(await saved(p)).pending.pieces[4].x;await p.keyboard.press('ArrowRight');assert.equal((await saved(p)).pending.pieces[4].x,oldX+5);
    await p.locator('#tgToMenu').click();report.checks.push('Native emulated touch drag, pointer capture, no page scrolling and keyboard movement');
    // Global voice/rate, cancel on leaving, background and no legacy record changes.
    await p.locator('#tgResume').click();await p.locator('#tgSpeak').click();let speech=await p.evaluate(()=>window.__speech.at(-1));assert.match(speech.text,/七块板/);assert.equal(speech.rate,.78);let stops=await p.evaluate(()=>window.__stops);await p.locator('#tgToMenu').click();assert.ok(await p.evaluate(n=>window.__stops>n,stops));
    await p.locator('#tgResume').click();await p.locator('#tgSpeak').click();stops=await p.evaluate(()=>window.__stops);await mode(p,'home');assert.ok(await p.evaluate(n=>window.__stops>n,stops));
    await mode(p,'tangram');await p.locator('#tgSpeak').click();stops=await p.evaluate(()=>window.__stops);await p.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});assert.ok(await p.evaluate(n=>window.__stops>n,stops));await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    const entries=await p.locator('[data-open-mode]').evaluateAll(nodes=>nodes.map(n=>n.dataset.openMode));
    for(const name of entries){await mode(p,name);assert.equal(await p.locator('body').getAttribute('data-mode'),name);}
    assert.equal(await p.evaluate(()=>localStorage.getItem('tongqu-listening-v1')),legacy);
    report.checks.push('Global speech rate and stop on back/activity change; all ten entries load, existing listening records unchanged');
    await context.close();
    // Storage unavailable from startup; malformed records. Neither should block play.
    for(const broken of ['blocked','corrupt']){
      const c=await browser.newContext({viewport:{width:390,height:844}});await c.addInitScript(mode=>{if(mode==='blocked')Object.defineProperty(window,'localStorage',{get(){throw Error('Storage disabled');}});else localStorage.setItem('tongqu-tangram-v1','{broken json');},broken);
      const q=await c.newPage();q.on('pageerror',e=>report.errors.push(e.message));await q.goto(base+'/#tangram');await q.locator('#tgFree').click();await dragPiece(q,0,250,200);assert.equal(await q.locator('[data-tg-piece="0"]').count(),1);if(broken==='blocked')assert.match(await q.locator('#tgStoragePlay').textContent(),/无法保存/);await c.close();
    }
    report.checks.push('Unavailable and corrupt storage permit continued play');
    for(const [width,height] of [[320,568],[360,640],[390,844],[412,915],[760,900],[1280,900],[568,320],[844,390]]){
      const c=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<761});await c.addInitScript(nativeFixture);const q=await c.newPage();q.on('pageerror',e=>report.errors.push(e.message));await q.goto(base+'/#tangram');await q.screenshot({path:path.join(out,`${width}x${height}-menu.png`)});await q.locator('[data-tg-level]').first().click();
      const rect=await q.locator('#tgBoard').boundingBox();assert.ok(rect.height>=150);assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await q.evaluate(()=>document.documentElement.scrollHeight>innerHeight+1),false);
      await q.screenshot({path:path.join(out,`${width}x${height}-play.png`)});await q.locator('#tgHint').click();await q.locator('#tgHint').click();await q.screenshot({path:path.join(out,`${width}x${height}-hint.png`)});assert.equal(await q.evaluate(()=>document.documentElement.scrollHeight>innerHeight+1),false);
      report.viewports.push({width,height,board:rect});await c.close();
    }
    assert.deepEqual(report.errors,[]);report.completed=true;console.log('All tangram checks passed');
  }finally{if(browser)await browser.close();server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
