'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const data=read('content/poetry/poems.json'),base=read('.checks/before-baidu-1.13/content/poetry/poems.base.json');
const audit=read('content/poetry/baidu-audit.json'),review=read('content/poetry/baidu-review.json');
const poem=n=>data.poems.find(p=>p.number===n),all=p=>p.verses.map(v=>v.text).join('');
assert.equal(data.poems.length,320);
for(const old of base){
 const current=poem(old.number);for(const key of ['id','number','title','author','type','meter','genre'])assert.equal(current[key],old[key],key+' changed for '+old.id);
 let expected=all(old);for(const c of review.textCorrections.filter(c=>c.number===old.number))expected=expected.replace(c.before,c.after);
 assert.equal(all(current),expected,'Unexpected source-text change '+old.id);assert.equal(current.verses.length,old.verses.length);
 assert.ok(current.study.translation.length&&current.notes.length>=3);
 for(const key of ['background','analysis','appreciation'])assert.ok(current.study[key].length>=20);
 const r=audit.poems.find(r=>r.id===current.id);assert.equal(current.reference.url,r.url);assert.equal(current.reference.pinyinStatus,r.pinyinStatus);
 for(const value of ['scene','pictureCaption','sourceTokens','sections'])assert.equal(value in current,false,'Research-only data bundled');
 for(const tokens of [current.titleTokens,current.authorTokens,...current.verses.map(v=>v.tokens),...current.notes.map(n=>n.tokens)])for(const [character,sound] of tokens)if(/\p{Script=Han}/u.test(character))assert.match(sound,/[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜêńňǹḿ]/i);
}
const sounds=(n,phrase)=>{const tokens=poem(n).verses.flatMap(v=>v.tokens),chars=tokens.map(t=>t[0]).join(''),at=chars.indexOf(phrase);assert.ok(at>=0);return tokens.slice(at,at+phrase.length).map(t=>t[1]).join(' ');};
assert.equal(sounds(6,'返景'),'fǎn jǐng');assert.equal(sounds(127,'场圃'),'cháng pǔ');assert.equal(sounds(24,'只'),'zhǐ');
assert.equal(sounds(229,'插发'),'chā fà');assert.equal(sounds(250,'都门'),'dū mén');assert.equal(sounds(250,'辗转'),'zhǎn zhuǎn');
assert.equal(sounds(273,'委蛇'),'wēi yí');assert.equal(sounds(309,'曲江曲'),'qǔ jiāng qū');assert.equal(sounds(313,'密密缝'),'mì mì féng');
// Protect full passages and literary readings when a reference page is incomplete or mispronounces them.
assert.equal(poem(228).verses.length,24);assert.equal(poem(281).verses.length,20);assert.ok(all(poem(266)).startsWith('昔有佳人公孙氏，一舞剑器动四方。'));
assert.equal(sounds(85,'中峰'),'zhōng fēng');assert.equal(sounds(280,'饮马'),'yìn mǎ');assert.equal(sounds(318,'没在'),'mò zài');assert.equal(sounds(293,'复醒'),'fù xǐng');
assert.ok(all(poem(176)).includes('射覆'));assert.ok(all(poem(177)).includes('残宵'));assert.ok(all(poem(262)).includes('白雪飞'));assert.ok(all(poem(268)).includes('玉花骢'));
assert.match(poem(262).study.translation.join(''),/白雪/);assert.match(poem(268).study.translation.join(''),/玉花/);
assert.equal(audit.stats.pinyinCompared+audit.stats.pinyinUnavailable,320);assert.equal(audit.stats.originalCompared,320);
const html=fs.readFileSync(path.join(root,'app/src/main/assets/index.html'),'utf8');const context={window:{}};
vm.runInNewContext(html.match(/<script id="poetry-data">([\s\S]*?)<\/script>/)[1],context);
assert.equal(JSON.stringify(context.window.TangPoetry),JSON.stringify(data));
assert.equal(html,fs.readFileSync(path.resolve(root,'../密码图卡乐园/密码图卡乐园.html'),'utf8'));
assert.ok(!html.includes('data-poetry-scene')&&!html.includes('function illustration(poem)'));
const report={completed:true,poems:320,verses:data.poems.reduce((s,p)=>s+p.verses.length,0),notes:data.poems.reduce((s,p)=>s+p.notes.length,0),studySections:1600,reference:audit.stats,oldIdsAndOrderPreserved:true,onlyReviewedTextChanges:true,baseLicenseRetained:data.license.includes('Permission is hereby granted')};
assert.equal(report.baseLicenseRetained,true);
fs.mkdirSync(path.join(__dirname,'tongqu-1.13'),{recursive:true});fs.writeFileSync(path.join(__dirname,'tongqu-1.13/data-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
