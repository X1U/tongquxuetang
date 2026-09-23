'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'online-voice-1.16'),destination=path.join(root,'.releases/local/1.16');
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name+'.json'))),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
  const verification=read('release-verification'),artifact=read('apk'),audio=read('audio'),preview=read('preview'),layout=read('layout'),global=read('global-voice');
  for(const report of [verification,artifact,audio,preview,layout,global,read('recovery'),read('updates')])assert.equal(report.completed,true);
  const status=await (await fetch('http://127.0.0.1:8765/api/speech/status',{signal:AbortSignal.timeout(10000)})).json();
  const online=status.voices.filter(v=>v.id.startsWith('online:')),local=status.voices.filter(v=>!v.id.startsWith('online:'));assert.equal(online.length,14);assert.equal(local.length,4);
  const apk=fs.readFileSync(artifact.apkPath);assert.equal(sha(apk),artifact.apkSHA256);
  fs.mkdirSync(destination,{recursive:true});const target=path.join(destination,'app.apk');
  if(fs.existsSync(target))assert.equal(sha(fs.readFileSync(target)),artifact.apkSHA256,'Do not replace a different archived release');
  fs.copyFileSync(artifact.apkPath,target);assert.equal(sha(fs.readFileSync(target)),artifact.apkSHA256);
  const record={releaseType:'local',published:false,createdAt:'2026-09-18',appName:artifact.appName,packageName:artifact.packageName,versionName:artifact.versionName,versionCode:Number(artifact.versionCode),apk:'app.apk',bytes:artifact.bytes,apkSHA256:artifact.apkSHA256,pageSHA256:artifact.pageSHA256,certificateSHA256:artifact.certificateSHA256,
    checks:{onlineChineseVoices:online.length,windowsLocalVoices:local.length,windowsTotalVoices:status.voices.length,onlineAudioSampleChecks:audio.samples.length,globalVoiceRoutes:global.engines.length,realBrowserVoices:preview.voices.length,realBrowserSpeechScenarios:preview.activities.length,fiveRates:true,slowResponseAndNetworkFailure:true,boundedRetryAndConcurrency:true,androidProtocolNetworkSynthesesOnHost:2,layoutViewports:new Set(layout.screens.map(s=>s.width+'x'+s.height)).size,layoutScreens:layout.screens.length,standaloneServiceLoads:true,dependencyFilesMatched:verification.dependencyFilesMatched,apkContents:true,signingCertificateUnchanged:true,credentialScanPassed:true},
    androidPhysicalDeviceTested:false,acceptanceRecord:'../../../.checks/童趣学堂1.16验收.md'};
  fs.writeFileSync(path.join(destination,'release.json'),JSON.stringify(record,null,2)+'\n');
  const acceptance=`# 童趣学堂 1.16 本地验收

验收日期：2026-09-18。版本：1.16 / versionCode 17。安装包已归档，未上传蒲公英；上一公开版仍为 1.13 / Build 8。

## 完成内容

- 接入当前 Microsoft Edge 在线朗读目录提供的全部 14 个中文声音：普通话 6 个、台湾普通话 3 个、粤语 3 个、东北话和陕西话各 1 个。首页按语言分组并标注男女声。
- 电脑预览保留慧慧（经典）、慧慧、瑶瑶、康康，共 18 个声音。Android 直接联网合成，不依赖电脑，也继续列出手机系统声音。
- 首页声音和五档语速供所有中文朗读入口共用；选择保存到设备。声音侦探的真实录音保持原速。
- 短暂连接故障最多重试一次，合成总期限仍为 25 秒；页面为合成和播放器准备预留 40 秒。持续失败提供切换本机声音或重试的提示。
- 目录支持刷新，失败保留已有列表；音频缓存有容量上限。切换设置、离开页面或进入后台会取消旧播放，Android 释放播放器并清理临时文件。
- 两份网页、两份预览后端和固定版本依赖已同步；APK 包含声音目录、原生在线播放实现及许可文件。

## 验证结果

- 实网音频：14 个声音均生成并解码为非静音 MP3，晓晓验证全部五档语速，较快档位的同一句时长依次缩短。共 ${audio.samples.length} 次样本检查，包含缓存复用；非法输入和缓存检查通过。
- 真实浏览器：逐个播放全部 14 个联网声音；首页、7 个活动入口、九字句整句和短语练习均使用选定声音及语速。自然结束、取消播放和重新选择检查通过。
- 故障检查：模拟服务不可用后，选择保持、忙碌状态清除，本机声音可恢复播放。人工延迟 21 秒的响应仍可正常开始听说练习；连接重试、并发上限、同请求合并和关闭处理通过独立检查。最终完整试听没有非预期的 HTTP 错误。
- 三条语音路径：服务端音频、模拟 Android 接口、模拟浏览器语音覆盖全部五档及各游戏；延迟初始化、重载保存、失效声音回退、禁用存储和连续分段取消通过。
- Android 生产协议：主机 JVM 使用生产协议完成文本转义、语速、时间签名及二进制帧检查，并实际请求晓晓和晓曼；两个 MP3 已在浏览器解码。生产 OnlineSpeech、协议与 OkHttp 实现已编译进 APK。
- 布局：${record.checks.layoutViewports} 种窗口、${layout.screens.length} 个界面通过既有布局检查；新增完整试听检查了 320×568、390×844、568×320，首页截图已查看。没有整页滚动或设置控件越界。
- 版本更新：版本比较、公开版本较旧提示、错误重试、安装链接及模拟 Android 更新接口通过。
- 分发文件：APK 内声音目录、网页、版本和许可与维护源一致；原生语音类、网络依赖及联网权限存在。两套预览的 10 个服务/配置文件和 ${verification.dependencyFilesMatched} 个依赖文件内容一致，独立目录可加载语音服务。
- 应用名、包名与签名保持一致，版本为 1.16 / 17；已配置发布凭据扫描通过。旧版 1.15 归档保留。

## 范围与限制

本次未连接实体 Android 设备。主机协议实网测试、模拟接口和 APK 编译不等同于手机实际扬声器试听。联网声音依赖设备网络及 Edge 公开在线朗读接口；离线时可选择已安装的本机声音。直接双击 HTML 只使用浏览器声音。

## 安装包

- 本地归档：.releases/local/1.16/app.apk
- 大小：${artifact.bytes.toLocaleString('en-US')} 字节。
- APK SHA256：${artifact.apkSHA256}
- 页面 SHA256：${artifact.pageSHA256}
- 签名 SHA256：${artifact.certificateSHA256}，与 1.15 相同。
- 发布记录：.releases/local/1.16/release.json

验收数据、语音样本和截图位于 .checks/online-voice-1.16/；维护说明位于 content/voices/README.md。
`;
  fs.writeFileSync(path.join(__dirname,'童趣学堂1.16验收.md'),acceptance);
  console.log(JSON.stringify({archived:true,path:target,bytes:artifact.bytes,version:artifact.versionName,voices:status.voices.length,published:false}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
