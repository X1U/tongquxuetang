'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),modulePath=path.join(root,'modules/voice-settings'),read=name=>fs.readFileSync(path.join(modulePath,name),'utf8');
function injectVoiceSettings(html){
  const catalog=fs.readFileSync(path.join(root,'content/voices/online-voices.json'),'utf8');
  const online=JSON.parse(catalog).voices;
  assert.ok(Array.isArray(online)&&online.length>0&&online.every(v=>v.id==='online:'+v.shortName&&v.local===false));
  for(const target of ['server/online-voices.json','app/src/main/assets/online-voices.json'])fs.writeFileSync(path.join(root,target),catalog,'utf8');
  const notice=fs.readFileSync(path.join(root,'content/voices/third-party-notices.txt'),'utf8');
  fs.writeFileSync(path.join(root,'app/src/main/assets/online-voice-notices.txt'),notice,'utf8');
  for(const type of ['styles','home','scripts'])html=html.replace(new RegExp('\\n[ \\t]*<!-- voice-settings:'+type+':start -->[\\s\\S]*?<!-- voice-settings:'+type+':end -->\\n','g'),'');
  const block=(type,content)=>'\n  <!-- voice-settings:'+type+':start -->\n'+content+'\n  <!-- voice-settings:'+type+':end -->\n';
  assert.ok(html.includes('</head>')&&html.includes('<!-- updates:home:start -->')&&html.includes('<script id="speech-audio">'));
  html=html.replace('</head>',block('styles','<style id="voice-settings-styles">\n'+read('styles.css')+'\n</style>')+'</head>');
  html=html.replace('<!-- updates:home:start -->',block('home',read('view.html'))+'<!-- updates:home:start -->');
  html=html.replace('  <script id="speech-audio">',block('scripts','<script id="voice-settings-app">\n'+read('app.js')+'\n</script>')+'  <script id="speech-audio">');
  html=html.replace(/(<script id="speech-audio">)[\s\S]*?<\/script>/,(_match,start)=>start+'\n'+read('audio.js')+'\n  </script>');
  return html;
}
module.exports={injectVoiceSettings};
