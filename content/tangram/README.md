# 七巧板乐园

首版内容为 24 个原创几何拼图，跟着拼、自己拼、挑战拼各 8 关。关卡是简化的七巧板造型，名称用于帮助孩子联想。2026-10-21 完成几何验证、逐关操作验证和本地 APK 构建。

## 内容与运行

- `levels.json` 是审核后的关卡源文件，按大三角、大三角、中三角、小三角、小三角、正方形、平行四边形排列七组顶点。总面积为 32，面积比例是 4:4:2:1:1:2:2。
- 每块只能平移、按 45° 旋转或翻面，统一缩放。前 3 关分别预放 5、4、2 块，其余关卡从空板开始。
- 首页图案直接来自“小房子”的标准解；关卡和几何逻辑直接打包进网页及 APK，可离线游玩。
- `modules/tangram/geometry.js` 计算凸多边形交集、轮廓、吸附和完成情况。完成以整体覆盖率和重叠面积判断，接受同尺寸三角形互换及有效替代拆分。
- `modules/tangram/app.js` 管理教学、拖动、旋转、翻面、分步提示、撤销、星星、继续上次拼图和六个自由作品位。
- 本机数据键为 `tongqu-tangram-v1`，与其他活动记录分开；保存失败有提示，仍可游玩。完成记录区分独立完成和获得帮助后完成。

## 维护与验证

修改 `levels.json` 后运行 `node scripts/prepare-tangram.cjs` 验证标准形状、七块使用情况、连接性、无重叠和可完成性；增加 `--gallery` 生成 `.checks/tangram/reviewed-levels.svg` 供人工核对轮廓。此脚本不再用随机候选覆盖已确认的关卡。

运行 `node scripts/build-poetry.cjs` 生成项目内的 `app/src/main/assets/index.html`。运行 `构建APK.ps1` 生成 `app/build/outputs/apk/debug/app-debug.apk`。独立网页同步需要显式使用现有同步入口。

浏览器回归脚本为 `.checks/tangram-regression.cjs`，需要可解析的 Playwright 和本机 Chrome。本机可在当前 PowerShell 进程设置 `NODE_PATH=C:/Users/admin/AppData/Roaming/npm/node_modules` 后运行。结果及八种屏幕尺寸截图位于 `.checks/tangram-1.22/`。图形总览和快速截图脚本为 `.checks/tangram-inspect.cjs`。

浏览器触摸及语音桥测试属于模拟验收；实体 Android 触屏手感、系统返回和实际声音仍需手机核对。短横屏的工具区可以上下滚动。
