'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { pinyin, customPinyin } = require('../tools/poetry-data/node_modules/pinyin-pro');
const { hanText, hash } = require('./poetry-comparison.cjs');
const root = path.resolve(__dirname, '..');
const content = path.join(root, 'content/poetry');
const modulePath = path.join(root, 'modules/poetry');
const read = name => fs.readFileSync(path.join(modulePath, name), 'utf8');
customPinyin(JSON.parse(fs.readFileSync(path.join(content, 'pronunciations.json'), 'utf8')));
const base = JSON.parse(fs.readFileSync(path.join(content, 'poems.base.json'), 'utf8'));
const annotations = fs.readdirSync(path.join(content, 'annotations')).filter(name=>name.endsWith('.jsonl')).sort().flatMap(name => fs.readFileSync(path.join(content,'annotations',name),'utf8').trim().split(/\r?\n/).map((line,index)=>{
  try{return JSON.parse(line);}catch(error){throw new Error(`${name}:${index+1} ${error.message}`);}
}));
assert.equal(annotations.length,320);
assert.equal(new Set(annotations.map(item=>item[0])).size,320,'Every poem needs exactly one explanation');
const annotationMap=new Map(annotations.map(item=>[item[0],item]));
const studies=fs.readdirSync(path.join(content,'studies')).filter(name=>name.endsWith('.jsonl')).sort().flatMap(name=>fs.readFileSync(path.join(content,'studies',name),'utf8').trim().split(/\r?\n/).map((line,index)=>{
  try{return JSON.parse(line);}catch(error){throw new Error(`${name}:${index+1} ${error.message}`);}
}));
assert.equal(studies.length,320);assert.equal(new Set(studies.map(item=>item[0])).size,320,'Every poem needs exactly one study entry');
const studyMap=new Map(studies.map(item=>[item[0],item]));
const review=JSON.parse(fs.readFileSync(path.join(content,'baidu-review.json'),'utf8'));
const audit=JSON.parse(fs.readFileSync(path.join(content,'baidu-audit.json'),'utf8'));
assert.equal(audit.poems.length,320);const references=new Map(audit.poems.map(item=>[item.number,item]));
const artScript=read('cover.js');
function noteTokens(word,poem){
  const all=poem.verses.flatMap(verse=>verse.tokens);
  const source=all.map(token=>token[0]).join('');
  const index=source.indexOf(word);
  if(index>=0){let position=0,start=0;while(start<all.length&&position<index)position+=all[start++][0].length;let remaining=word.length,end=start;while(end<all.length&&remaining>0)remaining-=all[end++][0].length;if(remaining===0)return all.slice(start,end);}
  return pinyin(word,{type:'all',toneSandhi:false}).map(token=>[token.origin,token.isZh?token.pinyin:'']);
}
const poems=base.map(poem=>{
  const record=annotationMap.get(poem.number);assert.ok(record,poem.title);
  const [number,,meaning,sourceNotes]=record;
  const studyRecord=studyMap.get(number);assert.ok(studyRecord,poem.title+' needs study content');
  const [,translation,background,appreciation]=studyRecord;
  assert.ok(Array.isArray(translation)&&translation.length&&translation.every(text=>typeof text==='string'&&text.trim().length>=10),poem.title+' needs a translation');
  assert.ok([meaning,background,appreciation].every(text=>typeof text==='string'&&text.trim().length>=20),poem.title+' needs useful explanatory text');
  const notes=sourceNotes.map(note=>[...note]);
  for(const revised of review.notes[number]||[]){const index=notes.findIndex(note=>note[0]===revised[0]);if(index<0)notes.push(revised);else notes[index]=revised;}
  assert.ok(notes.length>=3&&notes.every(note=>note.length===2&&note.every(value=>typeof value==='string'&&value.trim())));
  for(const tokens of [poem.titleTokens,poem.authorTokens,...poem.verses.map(v=>v.tokens)]){
    for(const [character,sound] of tokens)if(/\p{Script=Han}/u.test(character))assert.ok(sound&&!/\p{Script=Han}/u.test(sound),'Missing pinyin: '+character);
  }
  const reference=references.get(number);assert.ok(reference,poem.title+' needs a source link');
  assert.equal(hash(hanText(poem.verses.map(v=>v.text).join(''))),reference.localTextHash,'Reference audit is stale; rerun build-poetry-reference.cjs');
  assert.equal(hash(poem.verses.flatMap(v=>v.tokens).filter(t=>hanText(t[0])).map(t=>t[1]).join(' ')),reference.localPinyinHash,'Pinyin audit is stale');
  const url=new URL(reference.url);assert.equal(url.origin,'https://hanyu.baidu.com');assert.ok(['/s','/shici/detail','/hanyu-page/poem/list'].includes(url.pathname));
  return {...poem,variants:[...new Set([...poem.variants,...reference.variants])],study:{translation,background,analysis:meaning,appreciation},notes:notes.map(([word,meaning])=>({word,meaning,tokens:noteTokens(word,poem)})),reference:{url:reference.url,title:reference.sourceTitle,author:reference.sourceAuthor,textStatus:reference.textStatus,pinyinStatus:reference.pinyinStatus}};
});
assert.equal(poems.length,320);
assert.equal(new Set(poems.map(p=>p.id)).size,320);
const license=fs.readFileSync(path.join(content,'source/LICENSE.chinese-poetry.txt'),'utf8');
const stats={total:poems.length,meters:Object.fromEntries(['five','seven','mixed'].map(meter=>[meter,poems.filter(p=>p.meter===meter).length])),annotated:poems.filter(p=>p.notes.length>=3).length,studySections:5,translationParagraphs:poems.reduce((sum,p)=>sum+p.study.translation.length,0),references:audit.stats};
const gradle=fs.readFileSync(path.join(root,'app/build.gradle'),'utf8');
const version=gradle.match(/versionName\s+"([^"]+)"/)[1];
const data={version,source:'https://hanyu.baidu.com/hanyu-page/poem/list',baseSource:'https://github.com/chinese-poetry/chinese-poetry',explanationSource:'童趣学堂自编',referenceSummary:audit.summary,license,stats,poems};
fs.writeFileSync(path.join(content,'poems.json'),JSON.stringify(data)+'\n','utf8');
const asset=path.join(root,'app/src/main/assets/index.html');
let html=fs.readFileSync(asset,'utf8').replace(/\r\n/g,'\n');
for(const type of ['styles','home','view','scripts'])html=html.replace(new RegExp('\\n[ \\t]*<!-- poetry:'+type+':start -->[\\s\\S]*?<!-- poetry:'+type+':end -->\\n','g'),'');
const block=(type,contents)=>`\n  <!-- poetry:${type}:start -->\n${contents}\n  <!-- poetry:${type}:end -->\n`;
assert.ok(html.includes('</head>')&&html.includes('<footer class="footer">')&&html.includes('<script id="mode-router">'));
html=html.replace('</head>',block('styles','  <style id="poetry-styles">\n'+read('styles.css')+'\n'+read('screen.css')+'\n'+read('reader.css')+'  </style>')+'</head>');
const homePattern=/(<button class="mode-card pattern-mode"[\s\S]*?<\/button>)/;
assert.match(html,homePattern,'Keep the existing pattern game entrance');
html=html.replace(homePattern,'$1'+block('home',read('home-card.html')));
html=html.replace('    <footer class="footer">',block('view',read('view.html'))+'    <footer class="footer">');
const script='  <script id="poetry-data">\n  window.TangPoetry='+JSON.stringify(data).replace(/</g,'\\u003c')+';\n  </script>\n  <script id="poetry-app">\n'+artScript+'\n'+read('pagination.js')+'\n'+read('app.js')+'\n  </script>';
html=html.replace('  <script id="mode-router">',block('scripts',script)+'  <script id="mode-router">');
html=html.replace("pattern:'找规律 · 童趣学堂'};","pattern:'找规律 · 童趣学堂',poetry:'唐诗三百首 · 童趣学堂'};");
html=html.replace("pattern:'patternScreen'};","pattern:'patternScreen',poetry:'poetryScreen'};");
html=html.replace("const requested=window.location.hash.slice(1),mode=","const requested=window.location.hash.slice(1).split('/')[0],mode=");
html=html.replace("pattern:'patternTitle'}[mode]","pattern:'patternTitle',poetry:'poetryTitle'}[mode]");
html=html.replace(/(?:document\.documentElement\.dataset\.mode=mode;)?document\.body\.dataset\.mode=mode;document\.title=titles\[mode\];/,'document.documentElement.dataset.mode=mode;document.body.dataset.mode=mode;document.title=titles[mode];');
assert.equal((html.match(/document\.documentElement\.dataset\.mode=mode;/g)||[]).length,1,'Root scrolling follows the active mode');
assert.ok(html.includes("poetry:'poetryScreen'")&&html.includes("poetry:'poetryTitle'"));
html=require('./build-listening.cjs').injectListening(html);
html=require('./build-attention.cjs').injectAttention(html);
html=require('./build-tangram.cjs').injectTangram(html);
html=require('./build-updates.cjs').injectUpdates(html);
html=require('./build-voice-settings.cjs').injectVoiceSettings(html);
// Keep regenerated marker boundaries free of accumulating whitespace-only lines.
html=html.replace(/^[ \t]+$/gm,'');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,22,'Preserve all game, voice and update scripts');
scripts.forEach((script,index)=>new vm.Script(script[1],{filename:'inline-script-'+(index+1)}));
assert.equal((html.match(/data-open-mode="/g)||[]).length,10);
fs.writeFileSync(asset,html,'utf8');
const standalone=path.resolve(root,'../密码图卡乐园/密码图卡乐园.html');
const syncPreview=process.argv.includes('--sync-preview');
if(syncPreview){
  assert.ok(fs.existsSync(standalone),'Standalone version must be explicitly present');
  fs.writeFileSync(standalone,html,'utf8');
}
console.log(JSON.stringify({...stats,scripts:scripts.length,htmlBytes:Buffer.byteLength(html),synced:syncPreview},null,2));
