'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {lessons}=require('../scripts/build-attention.cjs');
const root=path.resolve(__dirname,'..'),out=require('./check-output.cjs').directory('attention-1.20'),data=lessons(),layoutOnly=process.argv.includes('--layout');
const report={completed:false,simulatedSpeech:true,checks:[],pageErrors:[],viewports:[]};
fs.mkdirSync(out,{recursive:true});
function nativeFixture({blocked=false}={}){
  window.__tts=[];window.__preparations=[];window.__stops=0;window.__voice='';
  const voices=[{id:'test-local',name:'测试中文',lang:'zh-CN',local:true},{id:'online:zh-CN-XiaoxiaoNeural',name:'晓晓',lang:'zh-CN',local:false}];
  window.AndroidTts={isReady:()=>true,listVoices:()=>JSON.stringify(voices),setVoice:id=>window.__voice=id,
    speakWithId(text,rate,id){window.__tts.push({text,rate,id,voice:window.__voice});window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}}));},
    stop(){window.__stops++;},prepare(texts,rate,voice){window.__preparations.push({texts:JSON.parse(texts),rate,voice});},cancelPreparation(){},installChineseVoice(){}};
  try{
    if(!localStorage.getItem('tongqu-global-voice-v1'))localStorage.setItem('tongqu-global-voice-v1',JSON.stringify({voiceId:voices[1].id,rate:.78}));
    if(!localStorage.getItem('tongqu-listening-v1'))localStorage.setItem('tongqu-listening-v1',JSON.stringify({prefs:{soundMode:'single',category:'all',trainMode:'commands',level:2},progress:{sound:7,train:5,commands:['command-01'],sentences:[]}}));
  }catch(_){}
  if(blocked)Object.defineProperty(window,'localStorage',{get(){throw Error('Storage disabled');}});
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{throw Error('Microphone is not part of this exercise');};
}
async function mode(page,value){await page.evaluate(value=>location.hash=value,value);await page.waitForFunction(value=>document.body.dataset.mode===value,value);}
async function finishAudio(page,state='end',id){await page.evaluate(({state,id})=>window.dispatchEvent(new CustomEvent('androidtts',{detail:{id:id||window.__tts.at(-1).id,state}})),{state,id});}
async function cardFor(page){const number=Number((await page.locator('#attentionCardNumber').textContent()).match(/卡 (\d+)/)[1]);return data.cards[number-1];}
async function choose(page,answer){
  const index=await page.locator('.attention-option-text').evaluateAll((nodes,answer)=>nodes.findIndex(node=>node.textContent===answer),answer);
  assert.ok(index>=0,'Expected answer is offered');await page.locator('[data-attention-choice="'+index+'"]').click();
}
async function remaining(page,card){
  while(await page.locator('#attentionQuestionPanel').isVisible()){
    const index=Number((await page.locator('#attentionQuestionNumber').textContent()).match(/问题 (\d+)/)[1])-1;
    assert.equal(await page.locator('#attentionQuestion').textContent(),card.questions[index].prompt);
    assert.deepEqual((await page.locator('.attention-option-text').allTextContents()).sort(),[...card.questions[index].options].sort());
    await choose(page,card.questions[index].answer);await page.locator('#attentionContinue').click();
  }
}
async function parentRead(page){await page.locator('#attentionParent').click();await page.locator('#attentionParentDone').click();await page.locator('#attentionContinue').click();}
async function saved(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('tongqu-attention-v1')||'null'));}
(async()=>{
  const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  async function context(options={}){
    const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,...options});
    await c.addInitScript(nativeFixture,{});const p=await c.newPage();p.setDefaultTimeout(10000);p.on('pageerror',error=>report.pageErrors.push(error.message));return {c,p};
  }
  try{
    if(!layoutOnly){
      const {c,p}=await context();await p.goto(base+'/#attention');
      assert.equal(await p.locator('[data-open-mode]').count(),9);
      assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.locator('#attentionContinue').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
      assert.equal(await p.locator('#attentionQuestionPanel').isVisible(),false);
      const legacy=await p.evaluate(()=>localStorage.getItem('tongqu-listening-v1'));
      let card=await cardFor(p);
      await p.waitForFunction(text=>window.__preparations.some(item=>item.texts.includes(text)),card.sentence);
      await p.locator('#attentionPlay').click();let last=await p.evaluate(()=>window.__tts.at(-1));
      assert.equal(last.text,card.sentence);assert.equal(last.rate,.78);assert.equal(last.voice,'online:zh-CN-XiaoxiaoNeural');
      assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.locator('#attentionStop').click();await finishAudio(p,'end',last.id);assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.locator('#attentionPlay').click();last=await p.evaluate(()=>window.__tts.at(-1));
      await p.locator('#attentionPlay').click();await finishAudio(p,'end',last.id);assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await finishAudio(p,'error');assert.equal(await p.locator('#attentionContinue').isDisabled(),true);assert.match(await p.locator('#attentionStatus').textContent(),/重试|家长/);
      await p.locator('#attentionPlay').click();await finishAudio(p);await p.locator('#attentionContinue').click();
      assert.equal(await p.locator('#attentionResultPanel').isVisible(),false);assert.ok(!(await p.locator('#attentionScreen').innerText()).includes(card.sentence));
      const options=await p.locator('.attention-option-text').allTextContents();await p.locator('#attentionReadQuestion').click();
      last=await p.evaluate(()=>window.__tts.at(-1));assert.ok(last.text.startsWith(card.questions[0].prompt));
      assert.ok(options.every((option,index)=>last.text.includes(['第一项，','第二项，','第三项，'][index]+option+'。')));
      assert.equal(await p.locator('.attention-option:disabled').count(),3);await finishAudio(p);
      const wrong=card.questions[0].options.find(option=>option!==card.questions[0].answer);await choose(p,wrong);
      assert.equal(await p.locator('.attention-option.is-correct').count(),1);assert.equal(await p.locator('.attention-option.is-wrong').count(),1);
      await p.locator('.attention-option.is-correct').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
      assert.equal((await saved(p))?.records?.[card.id],undefined);
      await p.locator('#attentionContinue').click();await remaining(p,card);
      assert.equal(await p.locator('#attentionResultTitle').textContent(),'答对 2 / 3 问');assert.equal(await p.locator('#attentionSentence').textContent(),card.sentence);
      assert.deepEqual((await saved(p)).records[card.id],{best:2,attempts:1});
      await mode(p,'home');await mode(p,'attention');assert.deepEqual((await saved(p)).records[card.id],{best:2,attempts:1});
      await p.locator('#attentionContinue').click();assert.ok(!(await p.locator('#attentionScreen').innerText()).includes(card.sentence));
      await parentRead(p);await remaining(p,card);assert.deepEqual((await saved(p)).records[card.id],{best:3,attempts:2});
      assert.equal(await p.evaluate(()=>localStorage.getItem('tongqu-listening-v1')),legacy);
      report.checks.push('Complete-sentence gate, stop/restart/error and stale completions; global voice/rate; preparation; question/option speech; one answer per question; accurate score, retry best score and separate legacy progress');
      await p.locator('#attentionNextCard').click();await p.locator('#attentionPlay').click();last=await p.evaluate(()=>window.__tts.at(-1));
      await p.locator('#attentionLevel').selectOption('3');await finishAudio(p,'end',last.id);assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.locator('#attentionPlay').click();last=await p.evaluate(()=>window.__tts.at(-1));await p.locator('#attentionNextCard').click();await finishAudio(p,'end',last.id);assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.locator('#attentionPlay').click();last=await p.evaluate(()=>window.__tts.at(-1));await mode(p,'train');await finishAudio(p,'end',last.id);assert.equal(await p.locator('#trainReview').isDisabled(),true);
      await p.locator('#trainPlay').click();await mode(p,'attention');assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.locator('#attentionPlay').click();last=await p.evaluate(()=>window.__tts.at(-1));await p.evaluate(()=>GlobalVoice.stopAll());await finishAudio(p,'end',last.id);assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.locator('#attentionPlay').click();last=await p.evaluate(()=>window.__tts.at(-1));await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await finishAudio(p,'end',last.id);assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      await p.locator('#attentionHelp').click();assert.equal(await p.evaluate(()=>AttentionCards.back()),true);assert.equal(await p.evaluate(()=>AttentionCards.back()),false);
      await p.locator('#attentionParent').click();await p.keyboard.press('Escape');assert.equal(await p.locator('#attentionDialog').isVisible(),false);assert.equal(await p.locator('#attentionContinue').isDisabled(),true);
      report.checks.push('Changing level/card/activity, global stop and backgrounding cancel old audio; hint/help back and Escape; closing a hint alone does not count as listening');await c.close();
      const all=await context();await all.p.goto(base+'/#attention');const seen=[];let answered=0;
      for(const level of [1,2,3]){
        if(level>1)await all.p.locator('#attentionLevel').selectOption(String(level));
        for(let i=0;i<8;i++){
          card=await cardFor(all.p);assert.equal(card.level,level);seen.push(card.id);
          await all.p.locator('#attentionPlay').click();assert.equal(await all.p.evaluate(()=>window.__tts.at(-1).text),card.sentence);
          await finishAudio(all.p);await all.p.locator('#attentionContinue').click();await remaining(all.p,card);answered+=card.questions.length;
          assert.equal(await all.p.locator('#attentionReview li').count(),level+2);assert.deepEqual((await saved(all.p)).records[card.id],{best:level+2,attempts:1});
          if(i<7)await all.p.locator('#attentionNextCard').click();
        }
      }
      assert.equal(new Set(seen).size,24);assert.equal(answered,96);const complete=await saved(all.p);assert.equal(Object.keys(complete.records).length,24);
      await all.p.reload();assert.deepEqual(await saved(all.p),complete);assert.equal(await all.p.locator('#attentionLevel').inputValue(),'3');assert.match(await all.p.locator('#attentionProgress').textContent(),/24 \/ 24/);
      report.cards=seen.length;report.questions=answered;report.checks.push('All 24 unique cards and 96 questions completed across three levels; answers, review, scoring and reload persistence');await all.c.close();
      const blocked=await browser.newContext({viewport:{width:390,height:844}});await blocked.addInitScript(nativeFixture,{blocked:true});const b=await blocked.newPage();b.on('pageerror',error=>report.pageErrors.push(error.message));await b.goto(base+'/#attention');card=await cardFor(b);await parentRead(b);await remaining(b,card);assert.match(await b.locator('#attentionResultTitle').textContent(),/3 \/ 3/);await blocked.close();
      const fallback=await browser.newContext({viewport:{width:390,height:844}});await fallback.addInitScript(()=>{
        window.__utterances=[];window.SpeechSynthesisUtterance=function(text){this.text=text;};
        Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{voiceURI:'browser-zh',name:'中文',lang:'zh-CN',localService:true}],addEventListener(){},cancel(){},resume(){},speak(value){window.__utterances.push(value);value.onstart?.();}},configurable:true});
      });
      const f=await fallback.newPage();f.on('pageerror',error=>report.pageErrors.push(error.message));await f.goto(base+'/#attention');card=await cardFor(f);await f.locator('#attentionPlay').click();assert.equal(await f.evaluate(()=>window.__utterances.at(-1).text),card.sentence);await f.evaluate(()=>window.__utterances.at(-1).onend());await f.locator('#attentionContinue').click();await f.locator('#attentionReadQuestion').click();assert.ok((await f.evaluate(()=>window.__utterances.at(-1).text)).startsWith(card.questions[0].prompt));await f.locator('#attentionStop').click();assert.equal(await f.locator('.attention-option:enabled').count(),3);await fallback.close();
      report.checks.push('Blocked storage still allows complete parent-led practice; browser speech fallback reads the sentence and questions');
    }else{
      for(const [width,height] of [[320,568],[360,640],[390,844],[412,915],[760,900],[1280,900],[568,320],[844,390]]){
        const {c,p}=await context({viewport:{width,height},isMobile:width<761,deviceScaleFactor:1});await p.goto(base+'/#home');
        async function screen(name,selector){
          await p.locator(selector).waitFor({state:'visible'});
          const bounds=await p.locator(selector).evaluate(element=>({rootWidth:document.documentElement.scrollWidth,rootHeight:document.documentElement.scrollHeight,outside:[...element.querySelectorAll('button,select')].filter(node=>node.getClientRects().length).map(node=>({id:node.id||node.getAttribute('data-open-mode'),rect:node.getBoundingClientRect().toJSON()})).filter(item=>item.rect.left<-.5||item.rect.top<-.5||item.rect.right>innerWidth+.5||item.rect.bottom>innerHeight+.5),contentOverflow:document.getElementById('attentionContent').scrollHeight-document.getElementById('attentionContent').clientHeight}));
          report.viewports.push({width,height,name,...bounds});await p.screenshot({path:path.join(out,width+'x'+height+'-'+name+'.png')});
          assert.ok(bounds.rootWidth<=width+1&&bounds.rootHeight<=height+1,'No page overflow: '+width+'x'+height+' '+name);assert.deepEqual(bounds.outside,[],'Controls fit the viewport: '+width+'x'+height+' '+name);
          if(name.startsWith('question'))assert.ok(bounds.contentOverflow<=2,'All three answer choices fit: '+width+'x'+height+' '+name);
        }
        assert.equal(await p.locator('[data-open-mode]').count(),9);await screen('home','#homeScreen');
        await p.locator('[data-open-mode="attention"]').click();await p.locator('#attentionLevel').selectOption('3');
        const longest=data.cards.reduce((best,card)=>Math.max(...card.questions.map(q=>q.prompt.length))>Math.max(...best.questions.map(q=>q.prompt.length))?card:best);
        for(let i=0;(await cardFor(p)).id!==longest.id&&i<8;i++)await p.locator('#attentionNextCard').click();
        assert.equal((await cardFor(p)).id,longest.id);await screen('listen','#attentionScreen');
        await p.locator('#attentionParent').click();await screen('parent','#attentionDialog');await p.locator('#attentionParentDone').click();await p.locator('#attentionContinue').click();
        const card=await cardFor(p);
        for(let index=0;index<card.questions.length;index++){
          await screen('question-'+(index+1),'#attentionScreen');await choose(p,card.questions[index].answer);
          await screen('answered-'+(index+1),'#attentionScreen');await p.locator('#attentionContinue').click();
        }
        await screen('result','#attentionScreen');
        await p.locator('#attentionHelp').click();await screen('help','#attentionDialog');await c.close();
      }
      report.checks.push('Eight phone/tablet/desktop viewports, including two landscape sizes; nine home entries, listening, all options, parent hint, review and help');
    }
    assert.deepEqual(report.pageErrors,[]);report.completed=true;
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,layoutOnly?'layout.json':'regression.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({completed:report.completed,cards:report.cards,questions:report.questions,checks:report.checks,viewports:report.viewports.length,pageErrors:report.pageErrors}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
