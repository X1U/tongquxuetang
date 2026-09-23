'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {hanText,alignCharacters,normalizeSound}=require('../scripts/poetry-comparison.cjs');
const poems=JSON.parse(fs.readFileSync(path.join(root,'content/poetry/poems.base.json'),'utf8'));
for(const poem of poems){
 const r=JSON.parse(fs.readFileSync(path.join(__dirname,'baidu-source/records',String(poem.number).padStart(3,'0')+'.json'),'utf8'));
 const local=poem.verses.flatMap(v=>v.tokens).filter(t=>hanText(t[0]));
 if(process.argv.includes('--zhi')){const wrong=local.flatMap((t,i)=>t[0]==='只'&&t[1]!=='zhǐ'?[{context:local.slice(Math.max(0,i-4),i+5).map(t=>t[0]).join(''),reading:t[1]}]:[]);if(wrong.length)console.log(JSON.stringify({number:poem.number,title:poem.title,wrong}));continue;}
 if(!r.matched||r.pinyinStatus==='unavailable')continue;
 if(!process.argv.includes('--all')&&r.textStatus!=='variant-review')continue;
 const source=r.sourceTokens.filter(t=>hanText(t[0])),diffs=[];
 for(const {a,b} of alignCharacters(local.map(t=>t[0]).join(''),source.map(t=>t[0]).join(''))){
  if(a===null||b===null||['一','不'].includes(local[a][0]))continue;
  if(normalizeSound(local[a][1])!==normalizeSound(source[b][1]))diffs.push({char:local[a][0],local:local[a][1],source:source[b][1],context:local.slice(Math.max(0,a-4),a+5).map(t=>t[0]).join('')});
 }
 if(diffs.length)console.log(JSON.stringify({number:poem.number,title:poem.title,diffs}));
}
