# 中文发音人与维护

1.16 将 Microsoft Edge 在线朗读接口在 2026-09-18 返回的全部 14 个中文声音接入首页。普通话 6 个、台湾普通话 3 个、粤语 3 个、东北话和陕西话各 1 个；名称、男女声和分组保存在 `online-voices.json`。电脑预览还保留 Windows 的 4 个中文声音，Android 继续枚举手机语音引擎提供的声音。

联网声音在首页按语言分组，选择联网声音后会为当前学习内容提前生成音频，并在点击朗读时复用。Android 直接连接在线服务，不需要电脑；局域网网页由电脑预览服务获取 MP3 再播放。直接双击 HTML 时没有预览接口，只能使用浏览器提供的声音。生活音效仍使用随应用打包的录音。

## 服务和限制

当前实现使用 Edge 在线朗读的公开接口，没有使用 Azure、阿里云或腾讯云账号。它并非带有服务承诺的商业语音 API；接口、可用声音及网络可达性可能改变。遇到持续故障可以在首页选择本机声音。

内置目录由已验证的 14 个声音构成。成功取得新目录后，24 小时内复用；刷新失败至少间隔 60 秒再尝试。Android 将最近成功目录保存在应用设置中，电脑预览在服务运行期间保留目录，重启后从内置目录开始。断网不会清空声音列表，但未缓存的联网朗读仍需要网络。

语音请求最长 800 字、合成总等待最多 25 秒。短暂连接故障最多重试一次，重试不重新延长总期限；服务明确拒绝时不循环重试。页面为联网合成与播放器准备预留 40 秒。切换设置、停止、离开活动或进入后台会取消旧播放。

1.18 起，Android 在应用专属的 `no_backup/voices/v1/`、电脑预览在项目内的 `.voice-cache/online-v1/` 保留长期缓存，最多约 64 MiB、1000 条，按最近使用淘汰。同一文字、发音人和语速共用音频；缓存有长度和 SHA-256 校验，损坏文件重新生成，缓存写入失败不阻止播放。普通覆盖升级或重启保留安卓音频；清除应用数据和卸载会删除。缓存不进入系统云备份，不新增存储权限。

Android 内存另限 8 MiB / 100 条，电脑服务内存限 16 MiB / 160 条，网页已准备音频限 16 MiB / 60 条。题目只准备最多 6 段；最多两个合成任务同时运行，其中后台准备最多占一个，为点击朗读留出位置。长诗第一段最多 80 字，后续段最多 220 字，播放当前段时准备接下来的两段。页面变化或进入后台会取消无用的准备；已有播放请求仍需要的同一合成不会被误取消。

## 维护入口

- `modules/voice-settings/`：首页统一声音及五档语速；新增分组自动显示。
- `server/online-speech.cjs`：电脑目录刷新、WebSocket 合成和缓存。
- `app/src/main/java/com/picturecard/learning/OnlineSpeech.java`：Android 目录、播放和生命周期。
- `SpeechAudioRepository.java` / `SpeechAudioCache.java`：Android 请求合并、点击优先级、取消和长期缓存；`OnlineSpeechTransport.java` 负责后台合成与重试。
- `modules/voice-settings/audio.js` / `server/speech-audio-cache.cjs`：网页准备与共享播放器、电脑长期缓存。
- `OnlineSpeechProtocol.java`：Android 协议、文本转义和二进制音频解析。
- `tools/online-speech/`：锁定 `node-edge-tts@1.2.10`（MIT）及依赖；协议常量来自该版本。首次使用电脑联网预览先运行 `npm ci --prefix tools/online-speech`。
- `third-party-notices.txt`：随 APK 打包的协议及 Android 网络库许可；页面生成无需从已安装的 Node 依赖提取许可。

修改目录或界面后运行 `node scripts/build-poetry.cjs`；它校验并同步两个网页，将声音目录和许可写入 Android 资源。修改预览服务后再运行 `node scripts/sync-preview.cjs`，同步独立网页版的服务和依赖，并重启预览。Android 使用 OkHttp 4.12.0，在构建时解析依赖。

## 验收

1.18 当前验收入口为 `.checks/speech-latency-server.cjs`、`.checks/run-speech-latency-java.cjs`、`.checks/speech-latency-ui.cjs` 和 `.checks/speech-latency-live.cjs`；结果在 `.checks/speech-latency-1.18/`。模拟合成测试使用独立目录，不污染正常预览的音频缓存；真实合成测试验证服务器和生产 Java 传输、跨重启读取及 MP3 解码。`.checks/global-voice-regression.cjs` 继续检查三个语音入口的原有行为。以下为 1.16 历史验收入口，部分页面断言基于当时的无预加载实现：

- `.checks/online-voice-audio.cjs`：核对在线目录，逐个合成、解码和检查音量，验证五档语速、缓存及错误输入。
- `.checks/online-voice-preview.cjs`：真实网页逐声试听、各游戏朗读、九字句与分段、断网恢复、慢响应、横竖屏和模拟 Android 接口。
- `.checks/online-voice-recovery.cjs`：重试次数、同一请求合并、并发上限、错误与关闭处理。
- `.checks/OnlineSpeechProtocolCheck.java`：使用生产 Java 协议进行解析检查和实际联网合成；浏览器再验证 MP3 可解码。

浏览器自动化和主机 Java 联网检查不等同于实体 Android 试听。正式上线前仍可在目标手机检查媒体音量、系统语音与设备网络。
