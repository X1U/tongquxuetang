'use strict';
// Offline editorial report. Raw reference articles stay in .checks and are never bundled.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {hanText,hash,normalizeSound,alignCharacters,textChanges}=require('./poetry-comparison.cjs');
const root=path.resolve(__dirname,'..'),content=path.join(root,'content/poetry');
const poems=JSON.parse(fs.readFileSync(path.join(content,'poems.base.json'),'utf8'));
const review=JSON.parse(fs.readFileSync(path.join(content,'baidu-review.json'),'utf8'));
const records=poems.map(poem=>{
  const r=JSON.parse(fs.readFileSync(path.join(root,'.checks/baidu-source/records',String(poem.number).padStart(3,'0')+'.json'),'utf8'));
  assert.ok(r.matched&&r.id===poem.id,'Missing reference match for '+poem.id);
  const url=new URL(r.url);assert.equal(url.origin,'https://hanyu.baidu.com');assert.ok(['/s','/shici/detail','/hanyu-page/poem/list'].includes(url.pathname));
  const local=poem.verses.flatMap(v=>v.tokens).filter(t=>hanText(t[0]));
  const source=(r.sourceTokens||[]).filter(t=>hanText(t[0]));
  const localText=hanText(poem.verses.map(v=>v.text).join('')),sourceText=hanText(r.sourceText);
  const available=source.length===[...sourceText].length&&source.every(t=>t[1]);
  const differences=textChanges(localText,sourceText),pinyinDifferences=[];
  if(available)for(const {a,b} of alignCharacters(localText,sourceText)){
    if(a===null||b===null||normalizeSound(local[a][1])===normalizeSound(source[b][1]))continue;
    pinyinDifferences.push({index:a,character:local[a][0],local:local[a][1],reference:source[b][1],context:local.slice(Math.max(0,a-4),a+5).map(t=>t[0]).join('')});
  }
  const variants=differences.map(d=>{
    const before=d.beforeContext?'…'+d.beforeContext:'',after=d.afterContext?d.afterContext+'…':'';
    return '百度汉语对照：本篇“'+before+d.local+after+'”；参考页“'+before+d.reference+after+'”。保留本篇写法。';
  });
  if(hanText(r.sourceTitle)!==hanText(poem.title))variants.unshift('参考页题名：《'+r.sourceTitle+'》。');
  if(hanText(r.sourceAuthor)!==hanText(poem.author))variants.unshift('参考页署名：'+r.sourceAuthor+'；本篇沿用'+poem.author+'。');
  return {id:poem.id,number:poem.number,title:poem.title,url:r.url,sourceTitle:r.sourceTitle,sourceAuthor:r.sourceAuthor,checkedAt:r.checkedAt,method:r.method,textStatus:differences.length?'variants-retained':'match',pinyinStatus:available?'compared':'unavailable',localTextHash:hash(localText),sourceTextHash:hash(sourceText),localPinyinHash:hash(local.map(t=>t[1]).join(' ')),sourcePinyinHash:available?hash(source.map(t=>t[1]).join(' ')):null,partOfGroup:r.partOfGroup||null,differences,pinyinDifferences,variants};
});
assert.equal(records.length,320);
const stats={total:records.length,originalCompared:records.length,textMatches:records.filter(r=>r.textStatus==='match').length,textVariantsRetained:records.filter(r=>r.textStatus==='variants-retained').length,pinyinCompared:records.filter(r=>r.pinyinStatus==='compared').length,pinyinUnavailable:records.filter(r=>r.pinyinStatus==='unavailable').length,textCorrections:review.textCorrections.length,reviewedPhrases:review.pronunciations.length};
const summary='本次已对照 '+stats.originalCompared+' 篇原文（不含标点），取得 '+stats.pinyinCompared+' 篇完整参考注音；另外 '+stats.pinyinUnavailable+' 篇尚未取得完整参考注音，沿用本篇注音，未标记为已逐字核对。';
fs.writeFileSync(path.join(content,'baidu-audit.json'),JSON.stringify({schemaVersion:1,source:review.reference,policy:review.policy,summary,stats,poems:records},null,2)+'\n','utf8');
const lines=['# 百度汉语对照记录','',summary,'','原文底本和320篇编号保持可追溯；明确校订见 baidu-review.json。以下差异是检索所得页面与本篇之间的逐字对照，不意味着参考页面一定正确。所有现代讲解均为项目自编，未将参考网站文章整段打包。','','## 原文字词校订','',...review.textCorrections.map(c=>`- ${String(c.number).padStart(3,'0')}：${c.before} → ${c.after}。${c.reason}`),'','## 篇目与参考覆盖','','| 编号 | 诗名 | 原文对照 | 完整参考注音 |','| --- | --- | --- | --- |',...records.map(r=>`| ${String(r.number).padStart(3,'0')} | [${r.title}](${r.url}) | ${r.textStatus==='match'?'相同':'保留异文，详见应用“异文”'} | ${r.pinyinStatus==='compared'?'已取得并比对':'未取得'} |`),'','注音比较包含字形规范、一/不变调、轻声及古今异读差异，不按差异数量自动改字。保留读法并不代表百度汉语背书。未取得的篇目可在有可靠的逐字注音资料后补核。',''];
fs.writeFileSync(path.join(content,'百度汉语校对记录.md'),lines.join('\n'),'utf8');
console.log(JSON.stringify(stats,null,2));
