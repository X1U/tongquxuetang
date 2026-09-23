'use strict';
const fs=require('node:fs'),path=require('node:path');
const directory=path.resolve(__dirname,'../content/poetry/studies');
const replacements=new Map([
 [1,['具体写作时间未在本版确认','具体写作时间尚难确考']],
 [46,['本版不作唯一断定','不宜作唯一断定']],
 [108,['本版先依落花、惜春与失落来理解','可以先从落花、惜春与失落来理解']],
 [151,['对人物具体身份的考证本版不作扩展。','将军的具体身份有不同考证，不宜径直套用于某一人物。']],
 [229,['是否实有其人并无本版确认的证据','是否实有其人尚无定论']],
 [251,['原选本收诗正文，本版保持篇目范围，不另增加序文为独立篇目。','诗的自序交代了送客、听曲与创作经过，可以帮助理解两位人物命运的相通。']],
 [266,['原选本保留诗正文，首联仍需完整呈现。','剑器是古代舞蹈名，诗人借舞艺的传承感受时代的变化。']],
 [281,['本版保持原有合篇方式，展示全部二十句。','五首分别写冷夜独处、捣衣、洒扫、望见夜宴和听砧等片段。']],
 [316,['本版保留原有两篇独立编号。','两篇以一问一答，写出旅途中遇见同乡的情景。']]
]);
for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.jsonl'))){
 const rows=fs.readFileSync(path.join(directory,name),'utf8').trim().split(/\r?\n/).map(JSON.parse);let changed=false;
 for(const row of rows){
  const pair=replacements.get(row[0]);if(pair&&row[2].includes(pair[0])){row[2]=row[2].replace(pair[0],pair[1]);changed=true;}
  if(row[0]===262&&row[1][0].includes('白云飞过')){row[1][0]=row[1][0].replace('白云飞过','白雪纷飞');changed=true;}
 }
 if(changed)fs.writeFileSync(path.join(directory,name),rows.map(row=>JSON.stringify(row)).join('\n')+'\n','utf8');
}
console.log('Study copy and selected text corrections aligned.');
