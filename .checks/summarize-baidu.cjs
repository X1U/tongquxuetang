'use strict';
const fs=require('node:fs'),path=require('node:path');
const base=JSON.parse(fs.readFileSync('content/poetry/poems.base.json','utf8'));
const {han}=require('../scripts/audit-baidu-poetry.cjs');
const records=fs.readdirSync('.checks/baidu-source/records').filter(n=>n.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join('.checks/baidu-source/records',name),'utf8'))).sort((a,b)=>a.number-b.number);
const counts=field=>records.reduce((out,r)=>{const key=r[field]||r.status||'unknown';out[key]=(out[key]||0)+1;return out;},{});
console.log(JSON.stringify({total:records.length,text:counts('textStatus'),pinyin:counts('pinyinStatus'),unmatched:records.filter(r=>!r.matched).map(r=>({number:r.number,title:r.title,candidates:r.candidates,error:r.error}))},null,2));
function changes(a,b){
 const x=[...a],y=[...b],w=y.length+1,d=new Uint16Array((x.length+1)*w);
 for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)d[i*w+j]=x[i]===y[j]?1+d[(i+1)*w+j+1]:Math.max(d[(i+1)*w+j],d[i*w+j+1]);
 let i=0,j=0,current=null;const out=[];
 while(i<x.length||j<y.length){if(i<x.length&&j<y.length&&x[i]===y[j]){if(current){current.afterContext=x.slice(i,i+5).join('');out.push(current);current=null;}i++;j++;}
 else{if(!current)current={index:i,beforeContext:x.slice(Math.max(0,i-5),i).join(''),before:'',source:''};if(j<y.length&&(i===x.length||d[i*w+j+1]>=d[(i+1)*w+j]))current.source+=y[j++];else current.before+=x[i++];}}
 if(current)out.push(current);return out;
}
if(process.argv.includes('--text'))for(const r of records.filter(r=>r.textStatus==='variant-review')){const p=base.find(p=>p.number===r.number);console.log(JSON.stringify({number:r.number,title:r.title,url:r.url,diffs:changes(han(p.verses.map(v=>v.text).join('')),han(r.sourceText))}));}
if(process.argv.includes('--pinyin'))for(const r of records.filter(r=>r.pinyinDifferences?.length)){const diffs=r.pinyinDifferences.filter(d=>d.before.normalize('NFC').replaceAll('ɡ','g')!==d.source.normalize('NFC').replaceAll('ɡ','g')&&!['一','不'].includes(d.character));if(diffs.length)console.log(JSON.stringify({number:r.number,title:r.title,diffs}));}
module.exports={changes};
