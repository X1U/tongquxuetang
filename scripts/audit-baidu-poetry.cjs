'use strict';
// Read public HTML only. No browser session, login, hidden JSON state or publishing API.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {load}=require('../tools/poetry-data/node_modules/cheerio');
const toSimplified=require('../tools/poetry-data/node_modules/opencc-js').Converter({from:'tw',to:'cn'});
const root=path.resolve(__dirname,'..'),out=path.join(root,'.checks/baidu-source');
const poems=JSON.parse(fs.readFileSync(path.join(root,'content/poetry/poems.base.json'),'utf8'));
const linksPath=path.join(root,'content/poetry/baidu-links.json');
const known=fs.existsSync(linksPath)?JSON.parse(fs.readFileSync(linksPath,'utf8')):{};
const extraQueries=JSON.parse(fs.readFileSync(path.join(root,'content/poetry/baidu-queries.json'),'utf8'));
const han=text=>String(text).normalize('NFKC').replace(/[^\p{Script=Han}]/gu,'');
const clean=text=>String(text).replace(/\s+/g,' ').trim();
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?Number(process.argv[i+1]):fallback;};
const start=option('--from',1),end=option('--to',320),refresh=process.argv.includes('--refresh');
const onlyIndex=process.argv.indexOf('--only'),only=onlyIndex<0?null:new Set(process.argv[onlyIndex+1].split(',').map(Number));
for(const dir of ['cache','records'])fs.mkdirSync(path.join(out,dir),{recursive:true});
function parse(html,url){
 const $=load(html);$('textarea,script,style,input[type="hidden"]').remove();
 const title=clean($('#poem-detail-header h1').text());
 const author=clean($('.poem-detail-header-author').first().text()).replace(/^【作者】\s*/,'');
 const body=$('#j_poem-body-content-wrapper');
 const tokens=body.find('.poem-item').map((_,el)=>{
   const item=$(el),text=clean(item.find('.text').text())||clean(item.clone().find('.pinyin').remove().end().text());
   return [[text,clean(item.find('.pinyin').text())]];
 }).get().filter(token=>token[0]);
 const plain=body.find('.j-poem-body-content.body .poem-detail-main-text');
 const text=tokens.length?tokens.map(token=>token[0]).join(''):(plain.length?plain:body.find('[id="body_p"]')).map((_,el)=>clean($(el).text())).get().join('');
 const candidates=$('a[href*="/shici/detail?"]').map((_,el)=>{
   const anchor=$(el);return {url:new URL(anchor.attr('href'),url).href,title:clean(anchor.text()),context:clean(anchor.parent().text()).slice(0,900)};
 }).get();
 const sections={};
 $('#means_zhushi_div .poem-detail-item').each((_,el)=>{
   const block=$(el),heading=clean(block.find('.poem-detail-item-title').first().text());
   const content=block.find('.poem-detail-item-content').map((_,node)=>clean($(node).text())).get().join('\n');
   if(heading&&content)sections[heading]=content;
 });
 return {url,title,author,text,tokens,sections,candidates,pinyinControl:$('#j_action-pinyin,.action-pinyin').length>0};
}
async function get(url){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.hostname!=='hanyu.baidu.com')throw Error('Unexpected reference host');
 const file=path.join(out,'cache',hash(url).slice(0,24)+'.html');
 let html;
 if(fs.existsSync(file))html=fs.readFileSync(file,'utf8');
 else{
   let response;
   for(let attempt=0;attempt<2;attempt++){
     try{response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'manual'});break;}
     catch(error){if(attempt)throw error;await wait(1500);}
   }
   if(response.status===429||response.status===403)throw Error('SOURCE_ACCESS_LIMIT_'+response.status);
   if(!response.ok)throw Error('HTTP_'+response.status);
   html=await response.text();
   if(/百度安全验证|请输入验证码/.test(html)&&!html.includes('poem-detail-header'))throw Error('SOURCE_VERIFICATION_REQUIRED');
   if(html.length>3000000)throw Error('Unexpected reference size');
   fs.writeFileSync(file,html,'utf8');await wait(450);
 }
 return parse(html,url);
}
function similarity(a,b){
 if(a===b)return 1;
 const pairs=new Set();for(let i=0;i<a.length-1;i++)pairs.add(a.slice(i,i+2));
 let found=0;for(let i=0;i<b.length-1;i++)if(pairs.has(b.slice(i,i+2)))found++;
 return found/Math.max(a.length-1,b.length-1,1);
}
function score(doc,poem){
 const author=text=>han(toSimplified(text)).replaceAll('馀','余').replace(/^(无名氏|佚名)$/,'佚名');
 if(!doc.title||author(doc.author)!==author(poem.author))return 0;
 const source=han(doc.text),expected=han(poem.verses.map(v=>v.text).join(''));
 const at=partOffset(source,expected);return at>=0?similarity(source.slice(at,at+expected.length),expected):similarity(source,expected);
}
function partOffset(source,expected){
 const exact=source.indexOf(expected);if(exact>=0)return exact;
 if(source.length<=expected.length)return -1;
 let best=-1,quality=.88;
 for(let i=0;i+expected.length<=source.length;i++){
   if(source.slice(i,i+3)!==expected.slice(0,3)&&source.slice(i+expected.length-3,i+expected.length)!==expected.slice(-3))continue;
   const value=similarity(source.slice(i,i+expected.length),expected);if(value>quality){quality=value;best=i;}
 }
 return best;
}
function selectPart(doc,poem){
 const expected=han(poem.verses.map(v=>v.text).join('')),source=han(doc.text),at=partOffset(source,expected);
 if(at<0||source.length===expected.length)return doc;
 const chars=[...doc.text],positions=[];chars.forEach((char,i)=>{if(han(char))positions.push(i);});
 const from=positions[at],to=positions[at+expected.length]??chars.length;
 let offset=0;const tokens=doc.tokens.filter(([text])=>{const before=offset;offset+=han(text).length;return before>=at&&before<at+expected.length;});
 return {...doc,text:chars.slice(from,to).join(''),tokens,partOfGroup:{start:at,length:expected.length,total:source.length}};
}
async function inspect(poem){
 const query=text=>'https://hanyu.baidu.com/s?wd='+encodeURIComponent(text)+'&from=poem';
 const urls=[...(known[poem.number]?[known[poem.number]]:[]),...(extraQueries[poem.number]||[]).map(query),query(poem.title+' '+poem.author)];
 const documents=[],visited=new Set();
 let requestCount=0;
 while(urls.length&&requestCount<6){
   const url=urls.shift();if(visited.has(url))continue;visited.add(url);requestCount++;
   const doc=await get(url);documents.push(doc);
   const quality=score(doc,poem),hasPinyin=doc.tokens.some(([char,sound])=>han(char)&&sound);
   if(quality>.9&&hasPinyin)break;
   const candidates=doc.candidates.filter(link=>{
     const title=han(link.title),context=han(link.context),first=han(poem.verses[0].text);
     return (title.includes(han(poem.title))||context.includes(first))&&(context.includes(han(poem.author))||title===han(poem.title));
   });
   for(const link of candidates)if(!visited.has(link.url))urls.push(link.url);
   if(requestCount===1&&!hasPinyin)urls.push(query(poem.title));
   if(requestCount===2&&quality<.55)urls.unshift(query(poem.verses[0].text.replace(/[，。？！；：]/g,'')));
   if(!urls.length&&requestCount<3&&!hasPinyin)urls.push(query(poem.verses[0].text.replace(/[，。？！；：]/g,'')));
   if(!urls.length&&requestCount<5&&quality<.55&&poem.title.includes('·'))urls.push(query(poem.title.split('·')[0]+' '+poem.author));
 }
 const withPinyin=doc=>doc.tokens.some(([char,sound])=>han(char)&&sound);
 documents.sort((a,b)=>score(b,poem)-score(a,poem)||Number(withPinyin(b))-Number(withPinyin(a))||Number(b.url.includes('/shici/detail'))-Number(a.url.includes('/shici/detail')));
 const best=documents[0],quality=best?score(best,poem):0;
 const original=poem.verses.map(v=>v.text).join(''),originalHan=han(original);
 const candidate=best&&quality>.55?selectPart(best,poem):null;
 const record={number:poem.number,id:poem.id,title:poem.title,author:poem.author,checkedAt:new Date().toISOString(),method:'public-rendered-html',queries:[...visited],matched:!!candidate,similarity:quality};
 if(!candidate){record.status='unresolved';record.candidates=documents.map(doc=>({url:doc.url,title:doc.title,author:doc.author,first:doc.text.slice(0,60)}));return record;}
 const sourceHan=han(candidate.text),sounds=candidate.tokens.filter(([char])=>han(char)).map(token=>token[1]);
 const localSounds=poem.verses.flatMap(v=>v.tokens).filter(([char])=>han(char)).map(token=>token[1]);
 const pinyinAvailable=sounds.length===sourceHan.length&&sounds.every(Boolean);
 Object.assign(record,{url:candidate.url,sourceTitle:candidate.title,sourceAuthor:candidate.author,sourceText:candidate.text,sourceTokens:candidate.tokens,partOfGroup:candidate.partOfGroup||null,sections:candidate.sections,textStatus:sourceHan===originalHan?'match':'variant-review',pinyinStatus:!pinyinAvailable?'unavailable':sourceHan!==originalHan?'text-diff':sounds.join(' ')===localSounds.join(' ')?'match':'difference-review',localTextHash:hash(originalHan),sourceTextHash:hash(sourceHan),localPinyinHash:hash(localSounds.join(' ')),sourcePinyinHash:pinyinAvailable?hash(sounds.join(' ')):null});
 if(pinyinAvailable&&sourceHan===originalHan)record.pinyinDifferences=sounds.flatMap((sound,index)=>sound===localSounds[index]?[]:[{index,character:[...sourceHan][index],before:localSounds[index],source:sound,context:[...sourceHan].slice(Math.max(0,index-4),index+5).join('')}]);
 return record;
}
async function main(){
 let done=0,consecutiveErrors=0;
 for(const poem of poems.filter(p=>p.number>=start&&p.number<=end&&(!only||only.has(p.number)))){
   const file=path.join(out,'records',String(poem.number).padStart(3,'0')+'.json');
   if(fs.existsSync(file)&&!refresh){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.status!=='error'&&!(process.argv.includes('--retry-incomplete')&&(!saved.matched||saved.pinyinStatus==='unavailable'))){done++;continue;}}
   try{const record=await inspect(poem);fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n','utf8');done++;consecutiveErrors=0;console.log(JSON.stringify({number:poem.number,title:poem.title,text:record.textStatus||record.status,pinyin:record.pinyinStatus||null}));}
   catch(error){
     fs.writeFileSync(file,JSON.stringify({number:poem.number,id:poem.id,title:poem.title,checkedAt:new Date().toISOString(),status:'error',error:error.message,cause:error.cause?.code||null},null,2)+'\n');
     console.error(JSON.stringify({number:poem.number,error:error.message,cause:error.cause?.code||null}));
     consecutiveErrors++;if(/SOURCE_/.test(error.message)||consecutiveErrors>=3)throw error;
   }
 }
 console.log(JSON.stringify({completed:done,from:start,to:end}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parse,han,similarity};
