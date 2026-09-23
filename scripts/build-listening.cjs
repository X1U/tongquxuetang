'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),content=path.join(root,'content/listening'),modules=path.join(root,'modules/listening');
const read=name=>fs.readFileSync(path.join(modules,name),'utf8');
function lessons(){
  const sounds=JSON.parse(fs.readFileSync(path.join(content,'sounds.json'),'utf8')).sounds;
  const commands=JSON.parse(fs.readFileSync(path.join(content,'commands.json'),'utf8')).commands;
  const sentences=JSON.parse(fs.readFileSync(path.join(content,'repeats.json'),'utf8')).sentences;
  assert.equal(sounds.length,24);assert.equal(commands.length,36);assert.equal(sentences.length,20);
  for(const group of [sounds,commands,sentences])assert.equal(new Set(group.map(s=>s.id)).size,group.length);
  for(const level of [1,2,3])assert.equal(commands.filter(s=>s.parts.length===level).length,12);
  for(const item of commands)assert.ok(item.parts.every(part=>part.length===2&&part.every(text=>typeof text==='string'&&text.trim())));
  for(const item of sentences){assert.equal([...item.text].length,9,item.id+' must contain nine characters');assert.match(item.text,/^\p{Script=Han}{9}$/u);assert.equal(item.chunks.join(''),item.text);assert.equal(item.chunks.length,3);}
  const packaged=sounds.map(sound=>{
    const audio=fs.readFileSync(path.join(content,sound.audio)),image=fs.readFileSync(path.join(content,sound.image));
    assert.equal(crypto.createHash('sha256').update(audio).digest('hex'),sound.source.sha256,'Lesson recording differs from the uploaded source');
    assert.ok(audio.length>1000&&image.length>500);
    return {id:sound.id,label:sound.label,category:sound.category,clue:sound.clue,audio:'data:audio/mpeg;base64,'+audio.toString('base64'),image:'data:image/webp;base64,'+image.toString('base64')};
  });
  return {sounds:packaged,commands,sentences};
}
function injectListening(html){
  for(const type of ['styles','home','view','scripts'])html=html.replace(new RegExp('\\n[ \\t]*<!-- listening:'+type+':start -->[\\s\\S]*?<!-- listening:'+type+':end -->\\n','g'),'');
  const block=(type,contents)=>`\n  <!-- listening:${type}:start -->\n${contents}\n  <!-- listening:${type}:end -->\n`;
  assert.ok(html.includes('<!-- poetry:home:end -->'));
  html=html.replace('</head>',block('styles','  <style id="listening-styles">\n'+read('styles.css')+'\n  </style>')+'</head>');
  html=html.replace('<!-- poetry:home:end -->','<!-- poetry:home:end -->'+block('home',read('home-card.html')));
  html=html.replace('    <footer class="footer">',block('view',read('view.html'))+'    <footer class="footer">');
  const scripts='<script id="listening-data">\nwindow.ListeningLessons='+JSON.stringify(lessons()).replace(/</g,'\\u003c')+';\n</script>\n<script id="listening-app">\n'+read('voice.js')+'\n'+read('art.js')+'\n'+read('app.js')+'\n</script>';
  html=html.replace('  <script id="mode-router">',block('scripts',scripts)+'  <script id="mode-router">');
  if(!html.includes("sound:'声音侦探 · 童趣学堂'"))html=html.replace(/(const titles=\{[^\n]+)(\};)/,"$1,sound:'声音侦探 · 童趣学堂',train:'听说小火车 · 童趣学堂'$2");
  if(!html.includes("sound:'soundScreen'"))html=html.replace(/(const screens=\{[^\n]+)(\};)/,"$1,sound:'soundScreen',train:'trainScreen'$2");
  if(!html.includes("sound:'soundTitle'"))html=html.replace("poetry:'poetryTitle'}[mode]","poetry:'poetryTitle',sound:'soundTitle',train:'trainTitle'}[mode]");
  for(const id of ['soundScreen','trainScreen','soundTitle','trainTitle'])assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes("sound:'soundScreen'")&&html.includes("train:'trainScreen'")&&html.includes("train:'trainTitle'"));
  return html;
}
module.exports={injectListening,lessons};
