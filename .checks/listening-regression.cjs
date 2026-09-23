'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=require('./check-output.cjs').directory('listening-1.14'),report={completed:false,checks:[],errors:[]};fs.mkdirSync(out,{recursive:true});
const readSaved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('tongqu-listening-v1')));
const audioEnd=page=>page.locator('#listeningMedia').evaluate(a=>a.dispatchEvent(new Event('ended')));
async function soundId(page){return page.evaluate(()=>{const src=document.getElementById('listeningMedia').getAttribute('src');return window.ListeningLessons.sounds.find(s=>s.audio===src)?.id;});}
async function ttsEnd(page,state='end'){await page.evaluate(state=>{const last=window.__tts.at(-1);window.dispatchEvent(new CustomEvent('androidtts',{detail:{id:last.id,state}}));},state);}
async function checkAll(page){for(const check of await page.locator('[data-listen-check]').all())await check.check();}
(async()=>{
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    await context.addInitScript(()=>{
      window.__tts=[];window.__media=[];window.__stops=0;
      window.AndroidTts={speakWithId(text,rate,id){window.__tts.push({text,rate,id});window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}}));},stop(){window.__stops++;},installChineseVoice(){}};
      HTMLMediaElement.prototype.play=function(){window.__media.push(this.getAttribute('src'));this.dispatchEvent(new Event('playing'));return Promise.resolve();};
      if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{throw Error('Microphone must not be requested');};
    });
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/#sound');
    assert.equal(await page.locator('#soundOptions button:disabled').count(),4);
    await page.locator('#soundOptions button').first().evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    assert.equal((await readSaved(page))?.progress?.sound||0,0);
    const seen=[];
    for(let round=0;round<24;round++){
      await page.locator('#soundPlay').click();const target=await soundId(page);assert.ok(target);seen.push(target);
      assert.equal(await page.locator('#soundOptions button:disabled').count(),4);await audioEnd(page);
      if(round===0){const wrong=page.locator('#soundOptions button').filter({hasNot:page.locator('[data-irrelevant]')});const id=await wrong.evaluateAll((els,target)=>els.find(e=>e.dataset.soundChoice!==target).dataset.soundChoice,target);await page.locator(`[data-sound-choice="${id}"]`).click();assert.equal((await readSaved(page))?.progress?.sound||0,0);await page.locator('#soundHint').click();assert.match(await page.locator('#soundFeedback').textContent(),/^线索：/);}
      await page.locator(`[data-sound-choice="${target}"]`).click();assert.equal((await readSaved(page)).progress.sound,round+1);
      await page.locator(`[data-sound-choice="${target}"]`).evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal((await readSaved(page)).progress.sound,round+1);
      if(round===4)assert.match(await page.locator('#soundProgress').textContent(),/徽章点亮/);
      await page.locator('#soundNext').click();
    }
    assert.equal(new Set(seen).size,24);report.checks.push('24 unique single-sound questions; playback gate, retry, hints, five-star badge and no duplicate awards');
    for(const category of ['body','objects']){
      await page.locator('#soundCategory').selectOption(category);
      const ids=await page.locator('[data-sound-choice]').evaluateAll(els=>els.map(e=>e.dataset.soundChoice));
      const categories=await page.evaluate(ids=>ids.map(id=>window.ListeningLessons.sounds.find(s=>s.id===id).category),ids);assert.ok(categories.every(c=>c===category));
    }
    await page.locator('[data-sound-mode="sequence"]').click();await page.locator('#soundPlay').click();
    const first=await soundId(page);await audioEnd(page);const second=await soundId(page);assert.notEqual(first,second);
    assert.equal(await page.locator('#soundOptions button:disabled').count(),4);await audioEnd(page);
    await page.locator(`[data-sound-choice="${second}"]`).click();assert.equal(await page.locator('.sound-order-slot.filled').count(),0);
    await page.locator(`[data-sound-choice="${first}"]`).click();assert.equal(await page.locator('.sound-order-slot.filled').count(),1);
    await page.locator(`[data-sound-choice="${second}"]`).click();assert.equal(await page.locator('.sound-order-slot.filled').count(),2);assert.equal((await readSaved(page)).progress.sound,25);
    await page.locator('#soundNext').click();await page.locator('#soundPlay').click();await page.locator('#soundStop').click();await audioEnd(page);assert.equal(await page.locator('#soundOptions button:disabled').count(),4);
    await page.locator('#soundPlay').click();await page.locator('#backHome').click();assert.equal(await page.locator('#listeningMedia').getAttribute('src'),null);
    report.checks.push('Body/object filters, two distinct sounds in strict order, mid-sequence stop and home navigation cancellation');
    await page.locator('[data-open-mode="train"]').click();assert.equal(await page.locator('#trainReview').isDisabled(),true);
    await page.locator('#trainPlay').click();assert.equal(await page.locator('#trainReview').isDisabled(),true);
    const native=await page.evaluate(()=>window.__tts.at(-1));assert.ok(native.id.startsWith('listening-'));assert.ok(native.text.startsWith('先'));
    await ttsEnd(page);assert.equal(await page.locator('#trainReview').isEnabled(),true);
    await page.locator('#trainReview').click();assert.equal(await page.locator('[data-listen-check]').count(),3);assert.equal(await page.locator('#listenApprove').isDisabled(),true);
    await page.locator('[data-listen-check]').first().check();assert.equal(await page.locator('#listenApprove').isDisabled(),true);
    await checkAll(page);await page.locator('#listenApprove').click();assert.equal((await readSaved(page)).progress.train,1);assert.equal(await page.locator('#trainReview').isDisabled(),true);
    assert.equal(await page.locator('#trainPrompt').textContent(),'又完成一个任务！');
    await page.locator('#trainNext').click();await page.locator('#backHome').click();await page.locator('#globalRateSelect').selectOption('0.65');await page.locator('[data-open-mode="train"]').click();await page.locator('#trainPlay').click();assert.equal(await page.evaluate(()=>window.__tts.at(-1).rate),.65);
    const obsolete=await page.evaluate(()=>window.__tts.at(-1).id);await page.locator('#trainLevel').selectOption('3');
    await page.evaluate(id=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'end'}})),obsolete);assert.equal(await page.locator('#trainReview').isDisabled(),true);
    for(const level of ['1','2','3']){
      await page.locator('#trainLevel').selectOption(level);await page.locator('#trainHint').click();assert.equal(await page.locator('.listen-steps li').count(),Number(level));
      await page.locator('[data-listen-action="parent-read"]').click();await page.locator('#trainReview').click();assert.equal(await page.locator('[data-listen-check]').count(),Number(level)+(level==='1'?0:1));
      await checkAll(page);await page.locator('#listenApprove').click();
    }
    assert.equal((await readSaved(page)).progress.train,4);report.checks.push('Native TTS start/end contract, one/two/three-step instructions, slow speech, stale callback rejection and item-by-item parent confirmation');
    await page.locator('[data-train-mode="repeat"]').click();const repeated=[];
    for(let i=0;i<20;i++){
      repeated.push(await page.locator('#trainTaskNumber').textContent());await page.locator('#trainHint').click();
      const sentence=await page.locator('.listen-sentence').textContent();assert.equal([...sentence].length,9);if(repeated.at(-1).includes(' · 3 /'))assert.equal(sentence,'我们一起去玩摩天轮');
      await page.locator('#listenDialogClose').click();await page.locator('#trainNext').click();
    }
    assert.equal(new Set(repeated).size,20);
    await page.locator('#trainChunks').click();assert.equal(await page.locator('[data-listen-part]').count(),3);
    await page.locator('[data-listen-part="0"]').click();await ttsEnd(page);assert.match(await page.locator('#listenDialogStatus').textContent(),/跟着说/);
    await page.locator('#listenDialogClose').click();assert.equal(await page.locator('#trainReview').isDisabled(),true,'A single phrase is not the full sample');
    await page.locator('#trainPlay').click();await ttsEnd(page,'error');assert.equal(await page.locator('#trainReview').isDisabled(),true);assert.match(await page.locator('#trainFeedback').textContent(),/重试/);
    await page.locator('#trainHint').click();await page.locator('[data-listen-action="parent-read"]').click();await page.locator('#trainReview').click();assert.equal(await page.locator('[data-listen-check]').count(),4);
    await page.locator('[data-listen-action="practice"]').click();assert.equal((await readSaved(page)).progress.train,4);
    await page.locator('#trainReview').click();await checkAll(page);await page.locator('#listenApprove').click();assert.equal((await readSaved(page)).progress.train,5);assert.match(await page.locator('#trainProgress').textContent(),/到达星星站/);
    const saved=await readSaved(page);await page.reload();assert.deepEqual(await readSaved(page),saved);assert.equal(await page.locator('[data-train-mode="repeat"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#globalRateSelect').inputValue(),'0.65');
    await page.locator('[data-listen-help="train"]').click();assert.equal(await page.evaluate(()=>window.ListeningGames.back()),true);assert.equal(await page.locator('#listenDialog').isVisible(),false);
    report.checks.push('All 20 nine-character sentences, corrected sentence 3, separate phrase practice, speech-error fallback, retry without rewards, saved settings/progress and Android dialog back');
    await context.close();
    const noStorage=await browser.newContext();await noStorage.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}});});
    const n=await noStorage.newPage();n.on('pageerror',e=>report.errors.push(e.message));await n.goto(base+'/#train');await n.locator('#trainHint').click();await n.locator('[data-listen-action="parent-read"]').click();await n.locator('#trainReview').click();await checkAll(n);await n.locator('#listenApprove').click();assert.match(await n.locator('#trainFeedback').textContent(),/确认完成/);await noStorage.close();
    assert.deepEqual(report.errors,[]);report.checks.push('Browser storage denial does not prevent learning');report.completed=true;
  }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'regression.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
