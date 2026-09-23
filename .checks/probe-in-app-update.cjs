'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'in-app-update-1.17');
const config=JSON.parse(fs.readFileSync(path.join(root,'app-update.json')));
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const response=await fetch(config.installUrl,{headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Public page unavailable');const html=await response.text();
  const field=name=>html.match(new RegExp('\\b'+name+'\\s*=\\s*[\'\"]([^\'\"]+)[\'\"]'))?.[1];
  const scripts=[...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(match=>match[1]).filter(url=>url.includes('app_view'));
  console.log(JSON.stringify({pageStatus:response.status,version:field('aVersion'),platform:field('aType'),appMatches:field('agKey')===config.appKey,scripts}));
  for(let i=0;i<scripts.length;i++){
    const script=await fetch(scripts[i],{signal:AbortSignal.timeout(15000)});if(!script.ok)throw Error('Public download script unavailable');
    fs.writeFileSync(path.join(out,'provider-download-'+i+'.js'),await script.text());
  }
  // Store only a redacted page fixture; never persist a live installation token.
  const redacted=html.replace(/(\b(?:installToken|password|buildPassword|authcode|timeSign|sig|speedToken|payToken)\s*=\s*)["'][^"']*["']/gi,'$1"REDACTED"');
  fs.writeFileSync(path.join(out,'public-page-redacted.html'),redacted);
  if(process.argv.includes('--download')){
    assert.equal(field('agKey'),config.appKey);assert.equal(field('aType'),'android');assert.match(field('aKey'),/^[a-f0-9]{32}$/);
    assert.equal(field('downloadPayMoney'),'0');
    const now=Date.now(),random=now%1000000,query=new URLSearchParams({time:String(now),installToken:field('installToken')});
    if(field('authcode'))query.set('finalCode',String(parseInt(field('authcode'))^random)+String(random).padStart(6,'0'));
    if(field('timeSign'))query.set('timeSign',Buffer.from(Buffer.from(field('timeSign'),'hex').toString('latin1').toLowerCase(),'latin1').toString('hex'));
    if(field('sig'))query.set('sig',field('sig'));
    let url='https://www.pgyer.com/app/install/'+field('aKey')+'?'+query;
    const cookies=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),hops=[];
    for(let hop=0;hop<6;hop++){
      const parsed=new URL(url);assert.equal(parsed.protocol,'https:');
      if(!(parsed.hostname==='www.pgyer.com'||parsed.hostname.endsWith('.pgyer.com'))){console.log(JSON.stringify({unrecognizedDownloadHost:parsed.hostname,hops}));throw Error('Check download host');}
      const download=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36','Referer':config.installUrl,...(parsed.hostname==='www.pgyer.com'&&cookies?{Cookie:cookies}:{})},signal:AbortSignal.timeout(40000)});
      hops.push({host:parsed.hostname,status:download.status});
      if([301,302,303,307,308].includes(download.status)){url=new URL(download.headers.get('location'),url).href;await download.body.cancel();continue;}
      assert.equal(download.status,200);assert.match(download.headers.get('content-type')||'',/application\/(?:vnd\.android\.package-archive|octet-stream|zip)/);
      const bytes=Buffer.from(await download.arrayBuffer()),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),published=JSON.parse(fs.readFileSync(path.join(root,'.releases/pgyer/latest.json')));
      assert.equal(sha256,published.artifact.apkSHA256);fs.writeFileSync(path.join(out,'public-download.apk'),bytes);
      const report={completed:true,version:field('aVersion'),bytes:bytes.length,sha256,archiveMatches:true,hops};fs.writeFileSync(path.join(out,'public-download.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
    }
    throw Error('Too many redirects');
  }
})().catch(()=>{console.error('Public download research could not complete');process.exitCode=1;});
