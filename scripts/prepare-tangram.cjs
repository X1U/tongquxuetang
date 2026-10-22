'use strict';
// The reviewed layouts in content/tangram/levels.json are the source of truth.
// Validate them and optionally export a review sheet; never replace them with random candidates.
const fs=require('node:fs'),path=require('node:path');
const g=require('../modules/tangram/geometry.js'),data=require('./build-tangram.cjs').lessons();
if(process.argv.includes('--write'))throw Error('Edit the reviewed levels.json directly; this command only validates or creates a gallery.');
if(process.argv.includes('--gallery')){
  const out=path.resolve(__dirname,'../.checks/tangram');fs.mkdirSync(out,{recursive:true});
  const escape=value=>value.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const cells=data.levels.map((level,i)=>{
    const {target}=g.fit(level.polygons),x=i%6*200,y=Math.floor(i/6)*190;
    return `<g transform="translate(${x} ${y})"><text x="12" y="22" font-size="14">${i+1}. ${escape(level.name)}</text><g transform="translate(10 36) scale(.3)">${target.map((p,j)=>`<polygon points="${p.map(v=>v.join(',')).join(' ')}" fill="${g.colors[j]}" stroke="white" stroke-width="2"/>`).join('')}</g></g>`;
  });
  fs.writeFileSync(path.join(out,'reviewed-levels.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760"><rect width="1200" height="760" fill="#fffdf6"/>${cells.join('')}</svg>`);
}
console.log('Validated '+data.levels.length+' reviewed tangram levels (8 per difficulty).');
