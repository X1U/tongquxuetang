'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const web = path.resolve(project, '../密码图卡乐园');
const backup = path.join(__dirname, 'before-remove-games-1.7-20260915');
assert.ok(!fs.existsSync(backup), 'The previous version backup must not be overwritten');
fs.mkdirSync(backup);

const files = {
  page: path.join(project, 'app/src/main/assets/index.html'),
  webPage: path.join(web, '密码图卡乐园.html'),
  activity: path.join(project, 'app/src/main/java/com/picturecard/learning/MainActivity.java'),
  gradle: path.join(project, 'app/build.gradle'),
  readme: path.join(project, 'README.md'),
  usage: path.join(web, '使用说明.txt'),
  release: path.join(project, '发布说明.txt'),
  verify: path.join(web, '.checks/verify.cjs'),
  countCheck: path.join(__dirname, 'count-regression.cjs'),
  modeCheck: path.join(__dirname, 'count-mode-regression.cjs'),
  voiceCheck: path.join(__dirname, 'voice-compat-regression.cjs')
};
const originals = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
for (const [key, file] of Object.entries(files)) fs.copyFileSync(file, path.join(backup, key + path.extname(file)));
fs.copyFileSync(path.join(project, 'app/build/outputs/apk/debug/app-debug.apk'), path.join(backup, 'app-1.7.apk'));

function replaceOnce(value, expression, replacement) {
  let matches = 0;
  const result = value.replace(expression, (...args) => { matches++; return typeof replacement === 'function' ? replacement(...args) : replacement; });
  assert.equal(matches, 1, 'Expected one match: ' + expression);
  return result;
}

let page = originals.page;
assert.equal(page, originals.webPage, 'Web and Android must start from the same version');
for (const mode of ['shadow', 'pattern']) {
  page = replaceOnce(page, new RegExp('^  <style id="' + mode + '-styles">[\\s\\S]*?</style>\\r?\\n', 'm'), '');
  for (const suffix of ['data', 'app']) page = replaceOnce(page, new RegExp('^  <script id="' + mode + '-' + suffix + '">[\\s\\S]*?</script>\\r?\\n', 'm'), '');
  page = replaceOnce(page, new RegExp('^    <main id="' + mode + 'Screen"[\\s\\S]*?</main>\\r?\\n', 'm'), '');
  page = replaceOnce(page, new RegExp('^        <button[^\\r\\n]*data-open-mode="' + mode + '"[^\\r\\n]*\\r?\\n', 'm'), '');
  page = replaceOnce(page, new RegExp('^  <div class="modal-overlay" id="' + mode + 'HelpOverlay"[^\\r\\n]*\\r?\\n', 'm'), '');
  const titleCase = mode[0].toUpperCase() + mode.slice(1);
  page = replaceOnce(page, new RegExp('<button[^>]*id="open' + titleCase + 'Help"[^>]*>[\\s\\S]*?</button>'), '');
  page = replaceOnce(page, new RegExp("^    \\$\\('home" + titleCase + "Art'\\)[^\\r\\n]*\\r?\\n", 'm'), '');
}
page = replaceOnce(page, /<meta name="description"[^>]+>/, '<meta name="description" content="密码图卡、物品分类、1–10 数量配对与数字描写。看图观察、分类、数数和练习表达，适合手机的儿童图卡学习乐园。">');
page = replaceOnce(page, '一起看图，数数，找规律吧。', '一起看图，分类，数数吧。');
page = replaceOnce(page, ",shadow:'找影子 · 图卡学习乐园',pattern:'找规律 · 图卡学习乐园'", '');
page = replaceOnce(page, ",shadow:'shadowScreen',pattern:'patternScreen'", '');
page = replaceOnce(page, ";$('openShadowHelp').hidden=mode!=='shadow';$('openPatternHelp').hidden=mode!=='pattern'", '');
page = replaceOnce(page, ",shadow:'shadowTitle',pattern:'patternTitle'", '');
page = replaceOnce(page, /^(      const requested=.*\r?\n)/m, line => line + "      if(requested&&requested!==mode)window.history.replaceState(null,'','#home');\r\n");
assert.ok(!/找影子|找规律|ShadowMatching|PatternLearning|shadowScreen|patternScreen/.test(page));
assert.equal([...page.matchAll(/data-open-mode="/g)].length, 3);
assert.equal([...page.matchAll(/<script id="/g)].length, 8);

let activity = originals.activity;
for (const global of ['ShadowMatchingUI', 'PatternLearningUI']) activity = replaceOnce(activity, new RegExp('^ +\\+ "if \\(mode[^\\r\\n]*' + global + '[^\\r\\n]*\\r?\\n', 'm'), '');
let gradle = replaceOnce(originals.gradle, 'versionCode 8', 'versionCode 9');
gradle = replaceOnce(gradle, 'versionName "1.7"', 'versionName "1.8"');

let verify = replaceOnce(originals.verify, 'Object.keys(scripts).length, 12', 'Object.keys(scripts).length, 8');
for (const mode of ['shadow', 'pattern']) verify = replaceOnce(verify, new RegExp("^vm.runInContext\\(scripts\\['" + mode + "-data'\\],context\\);\\r?\\n", 'm'), '');
verify = replaceOnce(verify, /const S=context\.window\.ShadowMatching;[\s\S]*$/, "console.log('PASS: Eight scripts parse, three games and homepage present, all images embedded; LAN speech uses the local audio endpoint.');\r\n");
let countCheck = replaceOnce(originals.countCheck, 'scripts.length, 12', 'scripts.length, 8');
countCheck = replaceOnce(countCheck, "page.locator('[data-open-mode]').count(), 5", "page.locator('[data-open-mode]').count(), 3");
let modeCheck = replaceOnce(originals.modeCheck, /        await page\.locator\('\[data-open-mode="shadow"\]'\)\.click\(\);[\s\S]*?        await page\.locator\('#backHome'\)\.click\(\); await page\.locator\('\[data-open-mode="sort"\]'\)\.click\(\);/, `        for (const retiredMode of ['shadow', 'pattern']) {
          await page.evaluate(mode => { location.hash = mode; }, retiredMode);
          await page.waitForFunction(() => location.hash === '#home' && document.body.dataset.mode === 'home');
          assert.equal(await page.locator('#homeScreen').isVisible(), true);
        }
        await page.locator('[data-open-mode="sort"]').click();`);
let voiceCheck = replaceOnce(originals.voiceCheck, /    await enter\(page, 'shadow'\);[\s\S]*?(?=    await enter\(page, 'cipher'\);)/, '');
voiceCheck = replaceOnce(voiceCheck, 'all five games', 'all three games');

let usage = replaceOnce(originals.usage, ' + 找影子 + 找规律', '');
usage = replaceOnce(usage, /2026-09-14 更新（1\.7）：[^\r\n]*/, '2026-09-15 更新（1.8）：移除“找影子”和“找规律”，首页保留三个大入口。保留全部九件商品分类、数量配对的随机/顺序模式与数字描写，以及手机 IP 预览的中文语音。');
usage = replaceOnce(usage, '五个板块都能在手机浏览器中使用', '三个板块都能在手机浏览器中使用');
usage = replaceOnce(usage, '6. 本次更新后先关闭旧预览窗口', '6. 修改预览服务后先关闭旧预览窗口');
usage = replaceOnce(usage, /\r?\n九、找影子[\s\S]*$/, '\r\n');
let readme = replaceOnce(originals.readme, '## IDEA 中启动手机 IP 预览', [
  '## 1.8 当前版本',
  '',
  '首页保留密码图卡、物品分类、数量配对三个入口，手机竖屏使用三张大卡片。移除找影子、找规律及其页面、帮助和脚本，原来的 `#shadow`、`#pattern` 链接会自动回到首页。',
  '',
  '物品分类继续同时展示全部九件商品；数量配对保留 1–10 随机/顺序数字自选、笔顺教学与描写。电脑 IP 预览的中文音频和首页“听听声音”继续可用，APK 使用手机系统中文语音。',
  '',
  '当前安装包：项目内 `app/build/outputs/apk/debug/app-debug.apk`，版本 1.8 / versionCode 9，沿用原签名。网页更新后刷新手机页面即可；APK 需要安装新版。',
  '',
  '## IDEA 中启动手机 IP 预览'
].join('\r\n'));
readme = replaceOnce(readme, '## 1.7 手机浏览器语音兼容', '## 历史版本记录\r\n\r\n以下为各版发布时的记录，当前可用游戏以 1.8 说明为准。\r\n\r\n## 1.7 手机浏览器语音兼容');
readme = replaceOnce(readme, /当前安装包：项目内 `app\/build\/outputs\/apk\/debug\/app-debug\.apk`，版本 1\.7 \/ versionCode 8，沿用项目签名。语音验证脚本：/, '1.7 语音验证脚本：');
const release = '移除找影子和找规律，首页保留密码图卡、物品分类、数量配对三个大入口。\r\n物品分类继续展示全部九件商品和大图。\r\n数量配对保留 1–10 顺序/随机模式、笔顺教学和数字描写。\r\n保留首页“听听声音”及各游戏朗读，旧游戏链接自动回到首页。\r\n电脑 IP 预览使用电脑生成的中文音频；APK 安装版使用手机系统中文语音。\r\n';

for (const [key, content] of Object.entries({ page, webPage: page, activity, gradle, verify, countCheck, modeCheck, voiceCheck, usage, readme, release })) fs.writeFileSync(files[key], content, 'utf8');
console.log('Updated both pages, Android navigation, version, existing checks and current instructions. Backup: ' + backup);
