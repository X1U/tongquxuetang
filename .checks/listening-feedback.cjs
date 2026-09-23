'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=require('./check-output.cjs').directory('listening-feedback-1.21');
const report={completed:false,checks:[],errors:[],screens:[]};
fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'));
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"available":false}');return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
});
const score=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('tongqu-listening-v1')).progress.sound);
const choose=(page,id)=>page.locator('[data-sound-choice="'+id+'"]').evaluate(button=>button.click());
const effectCount=page=>page.locator('.sound-answer-effect').count();
async function hear(page,sequence=false){
  await page.locator('#soundPlay').click();
  const target=()=>page.evaluate(()=>window.ListeningLessons.sounds.find(sound=>sound.audio===document.getElementById('listeningMedia').getAttribute('src')).id);
  const end=()=>page.locator('#listeningMedia').evaluate(audio=>audio.dispatchEvent(new Event('ended')));
  const first=await target();await end();
  if(!sequence)return [first];
  const second=await target();await end();return [first,second];
}
async function wrongId(page,target){
  return page.locator('[data-sound-choice]').evaluateAll((buttons,target)=>buttons.find(button=>button.dataset.soundChoice!==target).dataset.soundChoice,target);
}
async function capture(page,name){
  const file='feedback-'+name+'.png';await page.screenshot({path:path.join(out,file)});report.screens.push(file);
}
async function prepare(context){
  await context.addInitScript(()=>{
    localStorage.setItem('tongqu-listening-v1',JSON.stringify({prefs:{soundMode:'single',category:'all',trainMode:'commands',level:2},progress:{sound:0,train:4,commands:[],sentences:[]}}));
    window.AndroidTts={speakWithId(text,rate,id){window.dispatchEvent(new CustomEvent('androidtts',{detail:{id,state:'start'}}));},stop(){},installChineseVoice(){}};
    HTMLMediaElement.prototype.play=function(){this.dispatchEvent(new Event('playing'));return Promise.resolve();};
  });
}
(async()=>{
  let browser;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    await prepare(context);
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(base+'/#sound');
    await page.locator('[data-sound-choice]').first().evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    assert.equal(await effectCount(page),0);assert.equal(await score(page),0);
    let [target]=await hear(page),wrong=await wrongId(page,target);
    await choose(page,wrong);
    assert.equal(await page.locator('[data-answer-feedback="retry"]').count(),1);assert.equal(await score(page),0);
    assert.equal(await page.locator('[data-sound-choice="'+wrong+'"]').isEnabled(),true);
    await page.waitForTimeout(180);await capture(page,'wrong-390x844');
    await choose(page,wrong);assert.equal(await effectCount(page),1);
    await page.waitForTimeout(550);await choose(page,wrong);await page.waitForTimeout(650);
    assert.equal(await effectCount(page),1,'A newer wrong answer keeps its own feedback lifetime');
    await page.waitForTimeout(450);assert.equal(await effectCount(page),0,'Feedback expires without changing the question');
    await choose(page,wrong);await page.locator('#soundHint').click();assert.equal(await effectCount(page),0);
    await choose(page,target);
    assert.equal(await score(page),1);assert.equal(await page.locator('[data-answer-feedback="correct"]').count(),1);
    assert.equal(await page.locator('#soundStars .filled').count(),1);
    assert.ok(await page.locator('#soundStars .filled').evaluate(star=>star.getAnimations().some(animation=>animation.playState==='running')),'A newly earned star animates');
    await page.locator('[data-sound-choice="'+target+'"]').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    assert.equal(await score(page),1);assert.equal(await effectCount(page),1);
    await page.waitForTimeout(180);await capture(page,'correct-390x844');
    await page.locator('#soundNext').click();assert.equal(await effectCount(page),0);
    await page.waitForTimeout(1100);assert.match(await page.locator('#soundFeedback').textContent(),/^先点/);
    report.checks.push('Playback gate, distinct correct/retry feedback, repeat-tap lifetime, hint/next cleanup and one reward per question');
    await page.locator('[data-sound-mode="sequence"]').click();
    const [first,second]=await hear(page,true);
    await choose(page,first);assert.equal(await score(page),1);assert.equal(await page.locator('.sound-order-slot.filled').count(),1);
    await choose(page,second);assert.equal(await score(page),2);assert.equal(await page.locator('.sound-order-slot.filled').count(),2);
    await page.locator('[data-sound-mode="single"]').click();assert.equal(await effectCount(page),0);
    for(let i=0;i<3;i++){[target]=await hear(page);await choose(page,target);await page.locator('#soundNext').click();}
    assert.equal(await score(page),5);assert.equal(await page.locator('#soundStars .filled').count(),5);
    await capture(page,'five-stars-390x844');
    [target]=await hear(page);await choose(page,target);
    assert.equal(await score(page),6);assert.equal(await page.locator('#soundStars .filled').count(),1);
    report.checks.push('Two-sound order still earns one star, five-star completion stays visible and the next round wraps correctly');
    await page.locator('#soundNext').click();[target]=await hear(page);wrong=await wrongId(page,target);
    await choose(page,wrong);await page.locator('#backHome').click();assert.equal(await effectCount(page),0);
    await page.locator('[data-open-mode="sound"]').click();await choose(page,wrong);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
    assert.equal(await effectCount(page),0);
    await choose(page,wrong);await page.locator('[data-listen-help="sound"]').click();assert.equal(await effectCount(page),0);
    await page.locator('#listenDialogClose').click();await page.locator('#backHome').click();
    await page.locator('[data-open-mode="train"]').click();await page.locator('#trainHint').click();
    await page.locator('[data-listen-action="parent-read"]').click();await page.locator('#trainReview').click();
    for(const input of await page.locator('[data-listen-check]').all())await input.check();
    await page.locator('#listenApprove').click();
    assert.equal(await page.locator('#trainStars .filled').count(),5);
    assert.ok(await page.locator('#trainStars .filled').last().evaluate(star=>star.getAnimations().some(animation=>animation.playState==='running')));
    await page.waitForTimeout(650);await capture(page,'train-five-stars-390x844');
    await page.setViewportSize({width:568,height:320});await capture(page,'train-five-stars-568x320');
    assert.ok(await page.locator('#trainStars').isVisible());
    report.checks.push('Activity/background/help transitions clear transient effects; parent approval animates the train reward');
    await context.close();
    const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await prepare(reduced);
    const quiet=await reduced.newPage();quiet.on('pageerror',error=>report.errors.push(error.message));await quiet.goto(base+'/#sound');
    [target]=await hear(quiet);await choose(quiet,target);
    assert.equal(await quiet.locator('.sound-spark').count(),0);
    assert.ok(await quiet.locator('.sound-result-badge').isVisible());
    assert.equal(await quiet.locator('#soundOptions').evaluate(el=>el.getAnimations({subtree:true}).length),0);
    assert.equal(await quiet.locator('#soundStars').evaluate(el=>el.getAnimations({subtree:true}).length),0);
    assert.equal(await score(quiet),1);await capture(quiet,'reduced-motion-390x844');await reduced.close();
    report.checks.push('Reduced-motion mode retains clear answer and earned-star feedback without animation');
    assert.deepEqual(report.errors,[]);report.completed=true;
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
    fs.writeFileSync(path.join(out,'effects.json'),JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
