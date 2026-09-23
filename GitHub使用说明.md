# GitHub 私有源码仓库

目标仓库为个人账号 `X1U` 下的 `tongquxuetang`，使用 **Private** 可见性。

仓库保存 Android 源码、当前网页、模块、题库和素材、预览与发布脚本、固定版本的依赖清单，以及 `.checks/` 根目录的检查源码和验收说明。

安装包和发布归档、签名文件、API Key、环境变量文件、下载的 Android/Gradle 工具、依赖目录、缓存、截图、浏览器配置和检查运行记录只保留在本机，由 `.gitignore` 排除。文档中引用的本地发布记录和检查结果不会因此自动上传。

## 在原电脑继续开发

继续使用现有的 `构建APK.ps1`、`启动语音预览.ps1` 和 `发布蒲公英.ps1`。Git 提交仅同步源码；蒲公英发布仍按 [蒲公英自动发布说明](蒲公英自动发布.md) 执行。

## 在新电脑恢复

本项目沿用现有 Windows 构建环境。克隆源码后还需要：

1. 安装 Git、Node.js 24、PowerShell 7、JDK 17、Gradle 8.7 和 Android SDK 35，并根据新电脑路径配置 `local.properties` 及构建工具路径。
2. 恢复依赖：

   ```powershell
   npm ci --prefix tools/poetry-data --ignore-scripts --no-audit --no-fund
   npm ci --prefix tools/online-speech --ignore-scripts --no-audit --no-fund
   npm ci --prefix tools/pgyer --ignore-scripts --no-audit --no-fund
   ```

3. 要继续给已安装的应用提供覆盖更新，需从原电脑单独恢复原签名文件到 `.tools/signing/picture-learning-debug.keystore`；签名文件不通过 GitHub 传递。
4. 当前页面生成器同时同步相邻目录中的 `../密码图卡乐园/密码图卡乐园.html`。新电脑首次构建前，需要建立该目录，并将 `app/src/main/assets/index.html` 复制为该文件。
5. 发布认证通过环境变量或官方工具的网页授权恢复，按现有发布说明操作；不把凭据写入仓库。

只预览当前网页时，在依赖就绪后运行 `node 手机预览.cjs`，浏览器打开终端提示的本地地址即可。完整检查还需要 Playwright、Chrome，以及对应检查所依赖的本地历史结果或测试资料。
