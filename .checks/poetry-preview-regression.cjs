'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {createPageResponse}=require('../server/page-response.cjs');
const out=path.join(__dirname,'poetry-navigation'),root=path.resolve(__dirname,'..');
const preview=process.env.POETRY_PREVIEW_URL||'http://127.0.0.1:8765/';
function request(url,headers={},method='GET'){return new Promise((resolve,reject)=>{const start=performance.now();const req=http.request(url,{method,headers},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),ms:Math.round(performance.now()-start)}));});req.on('error',reject);req.end();});}
(async()=>{
  await fs.mkdir(out,{recursive:true});const content=await fs.readFile(path.join(root,'app/src/main/assets/index.html'));
  const normal=await request(preview),compressed=await request(preview,{'Accept-Encoding':'gzip'});
  assert.equal(normal.status,200);assert.deepEqual(normal.body,content);assert.equal(compressed.headers['content-encoding'],'gzip');assert.deepEqual(zlib.gunzipSync(compressed.body),content);
  assert.ok(compressed.body.length<content.length*.5);assert.match(compressed.headers.vary,/Accept-Encoding/i);assert.match(compressed.headers['cache-control'],/no-cache/);assert.notEqual(normal.headers.etag,compressed.headers.etag);
  for(const [headers,reference] of [[{},normal],[{'Accept-Encoding':'gzip'},compressed]]){
    const head=await request(preview,headers,'HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),reference.body.length);
    for(const tag of [reference.headers.etag,'W/'+reference.headers.etag,'"different", '+reference.headers.etag,'*']){
      const cached=await request(preview,{...headers,'If-None-Match':tag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);
    }
  }
  for(const encoding of ['gzip;q=0','br','gzip;q=0, *;q=1','identity']){const result=await request(preview,{'Accept-Encoding':encoding});assert.equal(result.headers['content-encoding'],undefined);assert.deepEqual(result.body,content);}
  assert.equal((await request(preview,{'Accept-Encoding':'*;q=0.8'})).headers['content-encoding'],'gzip');
  assert.equal((await request(preview,{'Accept-Encoding':'gzip','If-None-Match':normal.headers.etag})).status,200);
  for(const url of ['server/page-response.cjs','content/poetry/poems.json','AGENTS.md'])assert.equal((await request(preview+url)).status,404);
  assert.equal((await request(preview,{},'POST')).status,405);
  const fixture=path.join(out,'cache-fixture.html');await fs.writeFile(fixture,content);
  const serve=createPageResponse(fixture),server=http.createServer((req,res)=>serve(req,res).catch(()=>{res.writeHead(500);res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/';
    const concurrent=await Promise.all(Array.from({length:8},()=>request(url,{'Accept-Encoding':'gzip'})));
    concurrent.forEach(result=>{assert.equal(result.status,200);assert.deepEqual(zlib.gunzipSync(result.body),content);assert.equal(result.headers.etag,compressed.headers.etag);});
    const originalTag=concurrent[0].headers.etag;
    const edited=Buffer.concat([content,Buffer.from('\n<!-- saved edit A -->')]);await fs.writeFile(fixture,edited);
    const changed=await request(url,{'Accept-Encoding':'gzip','If-None-Match':originalTag});assert.equal(changed.status,200);assert.notEqual(changed.headers.etag,originalTag);assert.deepEqual(zlib.gunzipSync(changed.body),edited);
    const savedStat=await fs.stat(fixture),sameSize=Buffer.from(edited.toString().replace('saved edit A','saved edit B'));
    await fs.writeFile(fixture,sameSize);await fs.utimes(fixture,savedStat.atime,savedStat.mtime);
    const replaced=await request(url,{'Accept-Encoding':'gzip','If-None-Match':changed.headers.etag});assert.equal(replaced.status,200);assert.deepEqual(zlib.gunzipSync(replaced.body),sameSize);
    assert.equal((await request(url,{'Accept-Encoding':'gzip','If-None-Match':replaced.headers.etag})).status,304);
  }finally{await new Promise(resolve=>server.close(resolve));}
  const speech=await request(preview+'api/speech/status');assert.equal(JSON.parse(speech.body).available,true);
  const report={completed:true,identityBytes:normal.body.length,gzipBytes:compressed.body.length,reductionPercent:Math.round((1-compressed.body.length/normal.body.length)*1000)/10,unchangedRefreshStatus:304,unchangedRefreshBodyBytes:0,head:true,encodingNegotiation:true,editInvalidation:true,sameSizeEditInvalidation:true,concurrentRequests:8,privatePathsBlocked:true,speechAvailable:true};
  await fs.writeFile(path.join(out,'preview-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
