'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {loadConfig,inspectApk,runCommand}=require('../scripts/pgyer-release.cjs');
const root=path.resolve(__dirname,'..'),out=require('./check-output.cjs').directory('pgyer-update');
function entries(buffer){
  let end=buffer.length-22;while(end>=0&&buffer.readUInt32LE(end)!==0x06054b50)end--;
  assert.ok(end>=0);let offset=buffer.readUInt32LE(end+16);const files=new Map();
  for(let i=0;i<buffer.readUInt16LE(end+10);i++){
    assert.equal(buffer.readUInt32LE(offset),0x02014b50);const nameLength=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32),name=buffer.toString('utf8',offset+46,offset+46+nameLength),local=buffer.readUInt32LE(offset+42),size=buffer.readUInt32LE(offset+20),method=buffer.readUInt16LE(offset+10);
    const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),compressed=buffer.subarray(start,start+size);assert.ok([0,8].includes(method));files.set(name,method===8?zlib.inflateRawSync(compressed):compressed);offset+=46+nameLength+extra+comment;
  }
  return files;
}
(async()=>{
  const config=loadConfig(root),artifact=await inspectApk(root,config),files=entries(fs.readFileSync(artifact.apkPath));
  const badging=await runCommand(path.resolve(root,config.androidSdkPath,'build-tools',config.buildToolsVersion,process.platform==='win32'?'aapt.exe':'aapt'),['dump','badging',path.relative(root,artifact.apkPath)],{cwd:root});assert.equal(badging.code,0);
  const appName=badging.stdout.match(/^application-label:'([^']+)'/m)?.[1],expectedName=fs.readFileSync(path.join(root,'app/src/main/res/values/strings.xml'),'utf8').match(/<string name="app_name">([^<]+)<\/string>/)[1];assert.equal(appName,expectedName);
  const html=files.get('assets/index.html').toString('utf8'),metadata=JSON.parse(files.get('assets/app-update.json'));
  assert.equal(metadata.versionName,artifact.versionName);assert.equal(String(metadata.versionCode),artifact.versionCode);assert.equal(metadata.packageName,artifact.packageName);
  assert.deepEqual(metadata,JSON.parse(html.match(/window\.AppRelease=([^\n]+);/)[1]));
  assert.equal(html,fs.readFileSync(path.resolve(root,'../密码图卡乐园/密码图卡乐园.html'),'utf8'));
  const publicConfig=JSON.parse(fs.readFileSync(path.join(root,'app-update.json'),'utf8'));
  assert.equal(metadata.installUrl,publicConfig.installUrl);assert.equal(metadata.appKey,publicConfig.appKey);assert.equal(new URL(metadata.installUrl).search,'');
  const secrets=['PGYER_API_KEY','PGY_USERNAME','PGY_PASSWORD'].flatMap(name=>process.env[name]?.trim().length>=8?[process.env[name]]:[]);
  for(const value of secrets)for(const token of [Buffer.from(value),Buffer.from(value,'utf16le'),Buffer.from(encodeURIComponent(value))])for(const bytes of files.values())assert.equal(bytes.includes(token),false,'Credential found in packaged content');
  const report={completed:true,...artifact,appName,updateMetadataMatches:true,standaloneMatches:true,packagedEntries:files.size,credentialValuesChecked:secrets.length,apiKeyAvailableForScan:!!process.env.PGYER_API_KEY};
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'apk-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.name==='AssertionError'?'APK 内容校验未通过。':'APK 校验工具运行失败。');process.exitCode=1;});
