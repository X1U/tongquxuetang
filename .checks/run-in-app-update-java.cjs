'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),outputIndex=process.argv.indexOf('--output');
if(outputIndex>=0&&!process.argv[outputIndex+1])throw Error('Missing verification output directory');
const out=outputIndex>=0?path.resolve(root,process.argv[outputIndex+1]):path.join(__dirname,'in-app-update-1.17');
const relativeOutput=path.relative(__dirname,out);
if(relativeOutput.startsWith('..')||path.isAbsolute(relativeOutput))throw Error('Verification output must stay in .checks');
const classes=path.join(out,'java-classes');
const cache='C:/Users/admin/.gradle/caches/modules-2/files-2.1',java='C:/Users/admin/.jdks/ms-17.0.15/bin';
function jar(group,name,version){const dir=path.join(cache,group,name,version);for(const hash of fs.readdirSync(dir)){const file=path.join(dir,hash,name+'-'+version+'.jar');if(fs.existsSync(file))return file;}throw Error('Required JVM library missing');}
function run(exe,args){const child=spawnSync(path.join(java,exe+'.exe'),args,{cwd:root,encoding:'utf8',timeout:240000,windowsHide:true});if(child.status!==0){if(exe==='javac')process.stderr.write(child.stderr||'Compilation failed');else console.error(JSON.stringify({message:'Java update verification failed; network URLs and tokens withheld.',types:[...new Set((child.stderr||'').match(/[a-zA-Z_$][a-zA-Z0-9_$.]*(?:Exception|Error)\b/g)||[])],locations:(child.stderr||'').split(/\r?\n/).filter(line=>/^\s+at com\.picturecard\.learning\.[\w.$]+\([\w.]+:\d+\)$/.test(line)).map(line=>line.trim())}));process.exit(child.status||1);}process.stdout.write(child.stdout||'');}
fs.mkdirSync(classes,{recursive:true});
const cp=[jar('com.squareup.okhttp3','okhttp','4.12.0'),jar('com.squareup.okio','okio-jvm','3.6.0'),jar('org.jetbrains.kotlin','kotlin-stdlib','1.9.10')].join(path.delimiter);
run('javac',['-encoding','UTF-8','-cp',cp,'-d',classes,...['UpdatePage.java','UpdateDownload.java','UpdateInstallPolicy.java'].map(name=>path.join(root,'app/src/main/java/com/picturecard/learning',name)),path.join(__dirname,'UpdateTransportCheck.java'),path.join(__dirname,'UpdatePageCheck.java')]);
const args=['-cp',classes+path.delimiter+cp,'com.picturecard.learning.UpdateTransportCheck',out];
if(process.argv.includes('--live')){const config=JSON.parse(fs.readFileSync(path.join(root,'app-update.json'))),published=JSON.parse(fs.readFileSync(path.join(root,'.releases/pgyer/latest.json')));args.push(config.installUrl,config.appKey,published.artifact.apkSHA256);}
run('java',args);
const config=JSON.parse(fs.readFileSync(path.join(root,'app-update.json')));
run('java',['-cp',classes+path.delimiter+cp,'com.picturecard.learning.UpdatePageCheck',path.join(__dirname,'pgyer-update/public-page.html'),config.appKey]);
