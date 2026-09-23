'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadConfig,inspectApk,runCommand}=require('../scripts/pgyer-release.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'in-app-update-1.17');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function scripts(html){return new Map([...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((match,index)=>{const id=match[1].match(/\bid="([^"]+)"/)?.[1]||String(index);let body=match[2].trim();if(id==='poetry-data')body=body.replace(/^(window\.TangPoetry=\{"version":)"[0-9.]+"/,'$1"RELEASE"');return [id,sha(Buffer.from(body))];}).filter(([id])=>id!=='app-updates'));}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const config=loadConfig(root),artifact=await inspectApk(root,config),standard=JSON.parse(read('.checks/pgyer-update/apk-verification.json'));
  assert.equal(artifact.versionName,'1.17');assert.equal(String(artifact.versionCode),'18');assert.equal(artifact.apkSHA256,standard.apkSHA256);
  const previous=JSON.parse(read('.releases/local/1.16/release.json'));
  assert.equal(artifact.certificateSHA256,previous.certificateSHA256);assert.equal(artifact.packageName,previous.packageName);
  assert.equal(sha(fs.readFileSync(path.join(root,'.releases/local/1.16/app.apk'))),previous.apkSHA256);
  const aapt=path.join(root,config.androidSdkPath,'build-tools',config.buildToolsVersion,'aapt.exe');
  const manifest=await runCommand(aapt,['dump','xmltree',path.relative(root,artifact.apkPath),'AndroidManifest.xml'],{cwd:root});assert.equal(manifest.code,0);
  const provider=await runCommand(aapt,['dump','xmltree',path.relative(root,artifact.apkPath),'res/xml/update_paths.xml'],{cwd:root});assert.equal(provider.code,0);
  fs.writeFileSync(path.join(out,'manifest.xmltree.txt'),manifest.stdout);fs.writeFileSync(path.join(out,'provider.xmltree.txt'),provider.stdout);
  assert.match(manifest.stdout,/android\.permission\.REQUEST_INSTALL_PACKAGES/);assert.doesNotMatch(manifest.stdout,/android\.permission\.(?:READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE)/);
  const providerBlock=manifest.stdout.match(/E: provider[^\n]*\n(?:(?!\n\s{4}E:)[\s\S])*?androidx\.core\.content\.FileProvider[\s\S]*?android\.support\.FILE_PROVIDER_PATHS/);
  assert.ok(providerBlock,'FileProvider present in compiled manifest');
  assert.match(providerBlock[0],/com\.picturecard\.learning\.updates/);assert.match(providerBlock[0],/android:exported[^\n]*0x0/);assert.match(providerBlock[0],/android:grantUriPermissions[^\n]*(?:0xffffffff|0x1)/);
  assert.match(provider.stdout,/E: cache-path/);assert.match(provider.stdout,/path="updates\/"/);assert.doesNotMatch(provider.stdout,/E: (?:root-path|external-path|files-path)/);
  const html=read('app/src/main/assets/index.html'),before=read('.checks/before-in-app-update-1.17/app/src/main/assets/index.html');
  assert.deepEqual(scripts(html),scripts(before),'learning and voice blocks unchanged apart from generated release label');
  const native=read('app/src/main/java/com/picturecard/learning/AppUpdateBridge.java');
  assert.doesNotMatch(native,/CATEGORY_BROWSABLE|ACTION_VIEW,\s*Uri\.parse\(installUrl/);
  const voices=JSON.parse(read('app/src/main/assets/online-voices.json'));assert.equal(voices.voices.length,14);
  const ui=JSON.parse(read('.checks/in-app-update-1.17/ui.json')),java=JSON.parse(read('.checks/in-app-update-1.17/java-live.json'));
  assert.equal(ui.completed,true);assert.equal(java.completed,true);assert.equal(java.liveDownload.archiveMatches,true);assert.deepEqual(ui.externalRequests,[]);
  const report={completed:true,...artifact,appName:'童趣学堂',versionCode:Number(artifact.versionCode),apkBytes:fs.statSync(artifact.apkPath).size,pageSHA256:sha(Buffer.from(html)),compiledFileProviderVerified:true,privateCacheScopeVerified:true,installPermission:true,storagePermission:false,signingCertificateUnchanged:true,previousArchiveIntact:true,existingScriptBlocksUnchanged:scripts(html).size,onlineChineseVoices:voices.voices.length,productionJavaCases:java.productionJavaCases,livePublicApkMatchesArchive:true,nativeUiViewports:ui.viewports.length,externalUpdateBrowserRequests:0,credentialScan:standard.credentialValuesChecked,androidPhysicalDeviceTested:false,published:false};
  fs.writeFileSync(path.join(out,'release-verification.json'),JSON.stringify(report,null,2));
  if(process.argv.includes('--archive')){
    const destination=path.join(root,'.releases/local/1.17');fs.mkdirSync(destination,{recursive:true});const apk=path.join(destination,'app.apk');
    if(fs.existsSync(apk))assert.equal(sha(fs.readFileSync(apk)),artifact.apkSHA256,'preserve an existing different archive');else fs.copyFileSync(artifact.apkPath,apk);
    const release={releaseType:'local',published:false,createdAt:new Date().toISOString(),appName:'童趣学堂',packageName:artifact.packageName,versionName:artifact.versionName,versionCode:Number(artifact.versionCode),apk:'app.apk',bytes:report.apkBytes,apkSHA256:artifact.apkSHA256,pageSHA256:report.pageSHA256,certificateSHA256:artifact.certificateSHA256,notes:read('发布说明.txt').trim(),checks:{productionJavaCases:report.productionJavaCases,realPublicApkDownload:true,compiledProviderAndPermission:true,signingCertificateUnchanged:true,webAndLegacyUpdates:true,nativeUiViewports:report.nativeUiViewports,preExistingScriptBlocksUnchanged:report.existingScriptBlocksUnchanged,credentialsAbsent:true},androidPhysicalDeviceTested:false,acceptanceRecord:'../../../.checks/童趣学堂1.17验收.md'};
    fs.writeFileSync(path.join(destination,'release.json'),JSON.stringify(release,null,2)+'\n');report.archivedApk=apk;
  }
  console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.name==='AssertionError'?error.message:'Update release verification did not complete.');process.exitCode=1;});
