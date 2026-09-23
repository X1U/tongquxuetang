'use strict';
const fs=require('node:fs');
const {load}=require('../tools/poetry-data/node_modules/cheerio');
const crypto=require('node:crypto');
const number=process.argv.indexOf('--number');
const file=number>=0?'.checks/baidu-source/cache/'+crypto.createHash('sha256').update(JSON.parse(fs.readFileSync('.checks/baidu-source/records/'+process.argv[number+1]+'.json','utf8')).queries[0]).digest('hex').slice(0,24)+'.html':process.argv[2]||'.checks/baidu-source/jingyesi.html';
const $=load(fs.readFileSync(file,'utf8'));
// Inspect only rendered markup; exclude embedded application state and scripts.
$('textarea,script,style').remove();
$('[data]').removeAttr('data');
for(const selector of ['#poem-detail-header h1','.poem-detail-header-author','#j_poem-body-content-wrapper','.poem-item','#poem-detail-translation']){
 const elements=$(selector);
 console.log(selector,elements.length);
 if(selector.includes('wrapper')||selector.includes('translation'))console.log(elements.html()?.slice(0,4300));
 else console.log(elements.slice(0,6).map((_,el)=>$(el).text().replace(/\s+/g,' ').trim()).get());
}
console.log('canonical', $('link[rel="canonical"]').attr('href'));
console.log('page summary',$('title').text(),$('body').text().replace(/\s+/g,' ').trim().slice(0,700));
console.log('detail links',$('a').filter((_,el)=>/相思|王维|行宫|元稹|登鹳雀楼/.test($(el).text())).slice(0,15).map((_,el)=>({text:$(el).text().trim().slice(0,90),href:$(el).attr('href')})).get());
