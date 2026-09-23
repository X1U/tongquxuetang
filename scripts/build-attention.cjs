'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),modulePath=path.join(root,'modules/attention');
const read=name=>fs.readFileSync(path.join(modulePath,name),'utf8');
function lessons(){
  const data=JSON.parse(fs.readFileSync(path.join(root,'content/attention/cards.json'),'utf8'));
  assert.equal(data.cards.length,24,'Keep all attention training cards');
  assert.deepEqual(data.levels.map(level=>level.id),[1,2,3]);
  assert.equal(new Set(data.cards.map(card=>card.id)).size,data.cards.length);
  for(const level of data.levels){
    const cards=data.cards.filter(card=>card.level===level.id);
    assert.equal(cards.length,8,'Eight cards per difficulty');
    assert.equal(level.questions,level.id+2);
    for(const card of cards){
      assert.match(card.id,/^attention-\d{2}$/);
      assert.ok(card.sentence.length>=10&&card.sentence.length<=60);
      assert.match(card.sentence,/^[^。！？]+。$/,'Each card starts with one sentence');
      assert.equal(card.questions.length,level.questions);
      assert.equal(new Set(card.questions.map(question=>question.prompt)).size,card.questions.length);
      for(const question of card.questions){
        assert.ok(question.prompt.endsWith('？'));
        assert.equal(question.options.length,3);
        assert.equal(new Set(question.options).size,3);
        assert.ok(question.options.every(option=>typeof option==='string'&&option.trim()===option&&option.length>0&&option.length<=16));
        assert.equal(question.options.filter(option=>option===question.answer).length,1);
        assert.ok(card.sentence.includes(question.evidence)&&question.evidence.includes(question.answer),'Answers must be grounded in the sentence: '+card.id+' '+question.prompt);
      }
    }
  }
  return data;
}
function injectAttention(html){
  for(const type of ['styles','home','view','scripts'])html=html.replace(new RegExp('\\n[ \\t]*<!-- attention:'+type+':start -->[\\s\\S]*?<!-- attention:'+type+':end -->\\n','g'),'');
  const block=(type,contents)=>`\n  <!-- attention:${type}:start -->\n${contents}\n  <!-- attention:${type}:end -->\n`;
  assert.ok(html.includes('<!-- listening:home:end -->')&&html.includes('<script id="mode-router">'));
  html=html.replace('</head>',block('styles','<style id="attention-styles">\n'+read('styles.css')+'\n</style>')+'</head>');
  html=html.replace('<!-- listening:home:end -->','<!-- listening:home:end -->'+block('home',read('home-card.html')));
  html=html.replace('    <footer class="footer">',block('view',read('view.html'))+'    <footer class="footer">');
  const scripts='<script id="attention-data">\nwindow.AttentionLessons='+JSON.stringify(lessons()).replace(/</g,'\\u003c')+';\n</script>\n<script id="attention-app">\n'+read('app.js')+'\n</script>';
  html=html.replace('  <script id="mode-router">',block('scripts',scripts)+'  <script id="mode-router">');
  if(!html.includes("attention:'专注力听觉训练卡 · 童趣学堂'"))html=html.replace(/(const titles=\{[^\n]+)(\};)/,"$1,attention:'专注力听觉训练卡 · 童趣学堂'$2");
  if(!html.includes("attention:'attentionScreen'"))html=html.replace(/(const screens=\{[^\n]+)(\};)/,"$1,attention:'attentionScreen'$2");
  if(!html.includes("attention:'attentionTitle'"))html=html.replace("train:'trainTitle'}[mode]","train:'trainTitle',attention:'attentionTitle'}[mode]");
  assert.ok(html.includes("attention:'attentionScreen'")&&html.includes("attention:'attentionTitle'"));
  assert.equal((html.match(/id="attentionScreen"/g)||[]).length,1);
  return html;
}
module.exports={lessons,injectAttention};
