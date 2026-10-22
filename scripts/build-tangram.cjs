'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,'modules/tangram',name),'utf8');
function lessons(){
  const data=JSON.parse(fs.readFileSync(path.join(root,'content/tangram/levels.json'),'utf8')),g=require('../modules/tangram/geometry.js');
  assert.equal(data.levels.length,24);assert.equal(new Set(data.levels.map(l=>l.id)).size,24);
  for(const level of [1,2,3])assert.equal(data.levels.filter(l=>l.difficulty===level).length,8);
  for(const level of data.levels){assert.match(level.id,/^tangram-\d{2}$/);assert.ok(typeof level.name==='string'&&level.name.length>0&&level.name.length<=12);assert.ok(Number.isInteger(level.prefill)&&level.prefill>=0&&level.prefill<7);assert.ok(g.validLayout(level.polygons),level.name+' must be a connected, nonoverlapping standard seven-piece layout');const f=g.fit(level.polygons);assert.ok(g.metrics(f.target.map((p,i)=>g.poseFor(i,p,f.scale)),f.target,f.scale).complete);}
  return data;
}
function injectTangram(html){
  for(const type of ['styles','home','view','scripts'])html=html.replace(new RegExp('\\n[ \\t]*<!-- tangram:'+type+':start -->[\\s\\S]*?<!-- tangram:'+type+':end -->\\n','g'),'');
  const block=(type,contents)=>`\n  <!-- tangram:${type}:start -->\n${contents}\n  <!-- tangram:${type}:end -->\n`;
  html=html.replace('</head>',block('styles','<style id="tangram-styles">\n'+read('styles.css')+'\n</style>')+'</head>');
  const data=lessons(),g=require('../modules/tangram/geometry.js'),polys=data.levels[1].polygons,b=g.bounds(polys),padding=.6;
  const cover='<svg viewBox="'+[b.minX-padding,b.minY-padding,b.maxX-b.minX+padding*2,b.maxY-b.minY+padding*2].join(' ')+'">'+polys.map((poly,i)=>'<polygon points="'+poly.map(p=>p.join(',')).join(' ')+'" fill="'+g.colors[i]+'" stroke="#fffdf4" stroke-width=".06"/>').join('')+'</svg>';
  const home=read('home-card.html').replace('<!-- tangram:cover -->',cover);
  html=html.replace('<!-- attention:home:end -->','<!-- attention:home:end -->'+block('home',home));
  html=html.replace('    <footer class="footer">',block('view',read('view.html'))+'    <footer class="footer">');
  const script='<script id="tangram-data">\nwindow.TangramLessons='+JSON.stringify(data).replace(/</g,'\\u003c')+';\n</script>\n<script id="tangram-app">\n'+read('geometry.js')+'\n'+read('app.js')+'\n</script>';
  html=html.replace('  <script id="mode-router">',block('scripts',script)+'  <script id="mode-router">');
  if(!html.includes("tangram:'七巧板乐园 · 童趣学堂'"))html=html.replace(/(const titles=\{[^\n]+)(\};)/,"$1,tangram:'七巧板乐园 · 童趣学堂'$2");
  if(!html.includes("tangram:'tangramScreen'"))html=html.replace(/(const screens=\{[^\n]+)(\};)/,"$1,tangram:'tangramScreen'$2");
  html=html.replace("attention:'attentionTitle'}[mode]","attention:'attentionTitle',tangram:'tangramTitle'}[mode]");
  assert.ok(html.includes("tangram:'tangramTitle'"));assert.equal((html.match(/id="tangramScreen"/g)||[]).length,1);return html;
}
module.exports={lessons,injectTangram};
