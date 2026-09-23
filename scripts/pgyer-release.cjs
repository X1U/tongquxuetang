'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const root = path.resolve(__dirname, '..');
const cliRelative = 'tools/pgyer/node_modules/@pgyer/cli/dist/index.js';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function cleanError(message) {
  let text = String(message);
  const secrets = ['PGY_USERNAME', 'PGY_PASSWORD', 'PGYER_API_KEY', 'PGYER_INSTALL_PASSWORD'].flatMap(name => process.env[name] ? [process.env[name], encodeURIComponent(process.env[name])] : []);
  for (const value of [...new Set(secrets)].sort((left, right) => right.length - left.length)) text = text.split(value).join('[已隐藏]');
  return text.replace(/([?&](?:_api_key|username|password|buildPassword)=)[^&\s]+/gi, '$1[已隐藏]').slice(0, 1600);
}
function credentialPresence(environment = process.env) {
  return Object.fromEntries(['PGY_USERNAME', 'PGY_PASSWORD', 'PGYER_API_KEY'].map(name => [name, Boolean(environment[name]?.trim())]));
}
function authenticationHint(environment = process.env) {
  const available = credentialPresence(environment);
  const accountHint = available.PGY_USERNAME && available.PGY_PASSWORD
    ? '已读取 PGY_USERNAME 和 PGY_PASSWORD；账号密码不能直接用于蒲公英上传 API。'
    : available.PGY_USERNAME || available.PGY_PASSWORD ? 'PGY_USERNAME 和 PGY_PASSWORD 尚未配齐。' : '尚未配置蒲公英认证。';
  return accountHint + '请配置 PGYER_API_KEY，或在 IDEA 终端运行 .\\发布蒲公英.ps1 -Login 完成一次官方网页授权。';
}
function writeJson(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(file + '.tmp', file);
}
function runCommand(executable, args, { cwd = root, timeout = 30000, interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8'); if (stdout.length > 2 * 1024 * 1024) child.kill(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); if (stderr.length > 2 * 1024 * 1024) child.kill(); });
    child.on('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('无法启动工具：' + cleanError(error.message))); } });
    child.on('close', code => {
      clearTimeout(timer); if (settled) return; settled = true;
      if (timedOut) { const error = new Error('命令执行超时。'); error.code = 'TIMEOUT'; reject(error); }
      else resolve({ code, stdout, stderr });
    });
  });
}
function createCliRunner(project = root, nodePrefix = []) {
  return async (args, timeout = 30000) => {
    const result = await runCommand(process.execPath, [...nodePrefix, path.join(project, cliRelative), ...args, '--json'], { cwd: project, timeout });
    const values = (result.stdout + '\n' + result.stderr).split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const failure = values.find(value => value.error);
    if (result.code !== 0 || failure) {
      const code = failure?.error.code || 'CLI_FAILED';
      const messages = { AUTH_REQUIRED: '尚未登录蒲公英，请先登录或配置 PGYER_API_KEY。', AUTH_FAILED: '蒲公英认证失败，请检查 API Key。', TIMEOUT: '蒲公英处理超时。', RATE_LIMITED: '接口请求过于频繁，请稍后继续查询。', FILE_NOT_FOUND: '待上传的安装包不存在。', INVALID_ARGUMENT: '蒲公英工具的上传参数无效，请检查发布配置。' };
      // Vendor error bodies can contain signed upload URLs. Keep raw responses
      // out of console output and persistent release records.
      const error = new Error(messages[code] || (/^PGYER_\d+$/.test(code) ? '蒲公英返回错误 ' + code + '，请根据官方错误码核对。' : '蒲公英命令失败，请检查网络连接和账号状态。'));
      error.code = code; throw error;
    }
    const value = values.findLast(item => !item.info);
    requireThat(value && typeof value === 'object', '蒲公英工具没有返回有效结果。'); return value;
  };
}
function loadConfig(project, options = {}) {
  const config = readJson(path.join(project, 'pgyer.publish.json'));
  requireThat(config.schemaVersion === 1, '发布配置版本不正确。');
  requireThat(!Object.keys(config).some(key => /api.?key|token|password|username/i.test(key)), '账号、密码和 API Key 应通过环境变量或官方 CLI 登录配置，不要写入发布配置。');
  requireThat(['public', 'password', 'invite'].includes(config.installType), 'installType 只能是 public、password 或 invite。');
  requireThat(typeof config.packageName === 'string' && /^[a-f0-9]{64}$/i.test(config.certificateSHA256), '请配置包名和签名证书 SHA-256。');
  requireThat(['auto', 'domestic', 'overseas'].includes(config.uploadRegion), 'uploadRegion 配置不正确。');
  for (const name of ['uploadTimeoutSeconds', 'processingTimeoutSeconds']) requireThat(Number.isInteger(config[name]) && config[name] >= 10 && config[name] <= 3600, name + ' 必须为 10–3600 秒。');
  requireThat(config.pollIntervalSeconds >= 3 && config.pollIntervalSeconds <= 5, '按照官方建议，发布状态查询间隔应为 3–5 秒。');
  if (options.channel !== undefined) config.channelShortcut = options.channel;
  requireThat(typeof config.channelShortcut === 'string' && /^[\w-]*$/.test(config.channelShortcut), '渠道应填写已创建的渠道短链接，不要填完整网址或应用 ID。');
  config.notes = fs.readFileSync(path.resolve(project, options['notes-file'] || config.notesFile), 'utf8').replace(/^\uFEFF/, '').trim();
  requireThat(config.notes.length > 0 && config.notes.length <= 10000, '请在发布说明文件中填写本次更新内容，长度不能超过 10000 字符。');
  return config;
}
function zipEntry(buffer, wanted) {
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  requireThat(end >= 0, 'APK 文件结构不完整。');
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < buffer.readUInt16LE(end + 10); index++) {
    requireThat(buffer.readUInt32LE(offset) === 0x02014b50, 'APK 文件目录损坏。');
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20), local = buffer.readUInt32LE(offset + 42);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      requireThat([0, 8].includes(method), 'APK 使用了不支持的压缩格式。');
      return method === 8 ? zlib.inflateRawSync(buffer.subarray(start, start + size)) : buffer.subarray(start, start + size);
    }
    offset += 46 + nameLength + extra + comment;
  }
  throw new Error('APK 缺少 ' + wanted + '。');
}
async function inspectApk(project, config) {
  const apkPath = path.resolve(project, config.apkPath);
  requireThat(fs.existsSync(apkPath) && fs.statSync(apkPath).isFile(), '找不到 APK，请先构建项目。');
  const bytes = fs.readFileSync(apkPath), source = fs.readFileSync(path.join(project, 'app/src/main/assets/index.html'));
  requireThat(sha256(zipEntry(bytes, 'assets/index.html')) === sha256(source), 'APK 中的游戏页面不是当前版本，请重新构建后发布。');
  const tools = path.resolve(project, config.androidSdkPath, 'build-tools', config.buildToolsVersion);
  const badging = await runCommand(path.join(tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', path.relative(project, apkPath)], { cwd: project });
  requireThat(badging.code === 0, '无法读取 APK 版本，请检查 Android Build-Tools。');
  const info = badging.stdout.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);
  requireThat(info, 'APK 中没有有效的应用版本信息。');
  const gradle = fs.readFileSync(path.join(project, 'app/build.gradle'), 'utf8');
  requireThat(info[1] === config.packageName, 'APK 包名与发布配置不同，已停止上传。');
  requireThat(info[2] === gradle.match(/\bversionCode\s+(\d+)/)?.[1] && info[3] === gradle.match(/\bversionName\s+"([^"]+)"/)?.[1], 'APK 版本与当前构建配置不同，请重新构建。');
  const javaCandidates = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), path.join(os.homedir(), '.jdks/ms-17.0.15/bin/java.exe')].filter(Boolean);
  const java = javaCandidates.find(file => fs.existsSync(file)) || 'java';
  const signature = await runCommand(java, ['-jar', path.join(tools, 'lib/apksigner.jar'), 'verify', '--print-certs', apkPath], { cwd: project });
  const certificate = signature.stdout.match(/certificate SHA-256 digest:\s*([0-9a-f]{64})/i)?.[1]?.toLowerCase();
  requireThat(signature.code === 0 && certificate === config.certificateSHA256.toLowerCase(), 'APK 签名验证失败或签名与已有版本不同，已停止上传。');
  return { apkPath, bytes: bytes.length, apkSHA256: sha256(bytes), pageSHA256: sha256(source), packageName: info[1], versionCode: info[2], versionName: info[3], certificateSHA256: certificate };
}
function uploadArguments(artifactPath, config) {
  const args = ['upload', artifactPath, '--no-wait', '--build-update-description', config.notes, '--upload-region', config.uploadRegion, '--timeout', String(config.uploadTimeoutSeconds)];
  if (config.channelShortcut) args.push('--short', config.channelShortcut);
  if (config.installType === 'invite') args.push('--invite-install');
  if (config.installType === 'password') args.push('--password-env', 'PGYER_INSTALL_PASSWORD');
  return args;
}
function lockDirectory(directory) {
  const file = path.join(directory, '.publish.lock');
  if (fs.existsSync(file)) {
    const existing = readJson(file); let alive = true;
    try { process.kill(existing.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    requireThat(!alive, '此项目已有发布任务运行，请等它完成。'); fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' });
  return () => fs.unlinkSync(file);
}
async function publishVerifiedArtifact({ project = root, config, artifact, cli = createCliRunner(project), newUpload = false, resumeFile, log = console.log }) {
  const directory = path.join(project, '.releases/pgyer'); fs.mkdirSync(directory, { recursive: true });
  const unlock = lockDirectory(directory);
  let record, file;
  try {
    if (resumeFile) {
      file = path.resolve(project, resumeFile); const relative = path.relative(directory, file);
      requireThat(relative && !relative.startsWith('..') && !path.isAbsolute(relative), '只能继续本项目 .releases/pgyer 中的发布记录。');
      record = readJson(file);
      requireThat(record.schemaVersion === 1 && record.artifact?.packageName === config.packageName && record.uploadKey, '发布记录无效，或尚未取得上传标识。');
      requireThat(record.artifact.certificateSHA256 === config.certificateSHA256.toLowerCase(), '发布记录的签名与当前项目不同。');
    } else {
      const fingerprint = sha256(JSON.stringify({ apk: artifact.apkSHA256, notes: config.notes, installType: config.installType, channel: config.channelShortcut }));
      const suffix = newUpload ? '-' + Date.now() : '';
      const releaseDirectory = path.join(directory, fingerprint.slice(0, 24) + suffix); fs.mkdirSync(releaseDirectory, { recursive: true });
      file = path.join(releaseDirectory, 'release.json');
      if (fs.existsSync(file)) record = readJson(file);
      else {
        const savedApk = path.join(releaseDirectory, 'app.apk'); fs.copyFileSync(artifact.apkPath, savedApk);
        requireThat(sha256(fs.readFileSync(savedApk)) === artifact.apkSHA256, '安装包在归档时发生变化，已停止上传。');
        record = { schemaVersion: 1, status: 'prepared', createdAt: new Date().toISOString(), cliVersion: '0.1.5', installType: config.installType, channelShortcut: config.channelShortcut, notes: config.notes, artifact: { ...artifact, archivedApk: path.relative(project, savedApk) } };
        writeJson(file, record);
      }
    }
    const save = status => { record.status = status; record.updatedAt = new Date().toISOString(); writeJson(file, record); };
    if (record.status === 'published') { log('这个安装包和发布设置已有成功记录，已跳过重复上传。'); return { ...record, recordFile: file }; }
    if (!record.uploadKey) {
      requireThat(record.status === 'prepared', '上次上传结果尚未确认，请先到蒲公英后台核对；确认需要重新上传时使用 -NewUpload。');
      requireThat(sha256(fs.readFileSync(path.resolve(project, record.artifact.archivedApk))) === record.artifact.apkSHA256, '归档安装包校验失败。');
      save('uploading'); log('正在上传安装包，安装方式：' + ({ public: '公开安装', invite: '仅受邀用户', password: '密码安装' }[record.installType]) + '。');
      try {
        const uploaded = await cli(uploadArguments(path.resolve(project, record.artifact.archivedApk), config), (config.uploadTimeoutSeconds + 10) * 1000);
        requireThat(uploaded.success === true && uploaded.status === 'uploaded' && typeof uploaded.uploadKey === 'string' && uploaded.uploadKey.length > 0, '上传工具没有返回有效的上传标识。');
        record.uploadKey = uploaded.uploadKey; save('processing');
      } catch (error) { record.lastError = cleanError(error.message); save('upload_unconfirmed'); throw new Error('上传结果尚未确认：' + record.lastError + '\n请先核对蒲公英后台，避免重复上传。记录：' + file); }
    }
    log('安装包已上传，正在等待蒲公英完成发布。');
    try {
      const published = await cli(['uploads', 'wait', record.uploadKey, '--timeout', String(config.processingTimeoutSeconds), '--poll-interval', String(config.pollIntervalSeconds)], (config.processingTimeoutSeconds + 10) * 1000);
      requireThat(published.status === 'published' && published.pending === false && published.buildKey, '蒲公英尚未确认发布完成。');
      requireThat(published.buildIdentifier === record.artifact.packageName && String(published.buildVersionNo) === record.artifact.versionCode && published.buildVersion === record.artifact.versionName, '蒲公英返回的包名或版本与归档 APK 不同，请核对后台。');
      requireThat(typeof published.shortcut === 'string' && /^[\w-]+$/.test(published.shortcut), '发布已处理，但未取得有效的安装短链接，请核对后台。');
      record.buildKey = published.buildKey; record.buildBuildVersion = published.buildBuildVersion;
      record.url = 'https://www.pgyer.com/' + published.shortcut; record.publishedAt = new Date().toISOString(); delete record.lastError;
      save('published'); writeJson(path.join(directory, 'latest.json'), record);
      return { ...record, recordFile: file };
    } catch (error) {
      record.lastError = cleanError(error.message); save('processing_unconfirmed');
      throw new Error('尚未确认发布完成：' + record.lastError + '\n下次运行会继续查询，不会再次上传。记录：' + file);
    }
  } finally { unlock(); }
}
async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { check: { type: 'boolean' }, 'skip-build': { type: 'boolean' }, login: { type: 'boolean' }, 'new-upload': { type: 'boolean' }, 'notes-file': { type: 'string' }, channel: { type: 'string' }, resume: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('发布：.\\发布蒲公英.ps1\n只检查：.\\发布蒲公英.ps1 -Check -SkipBuild\n本机登录：.\\发布蒲公英.ps1 -Login\n继续查询：.\\发布蒲公英.ps1 -Resume .releases/pgyer/<记录目录>/release.json'); return; }
  requireThat(fs.existsSync(path.join(root, cliRelative)), '请先安装项目发布工具：npm ci --prefix tools/pgyer --ignore-scripts --no-audit --no-fund');
  requireThat(!(values.resume && (values['new-upload'] || values.check)), '-Resume 不能与 -NewUpload 或 -Check 同时使用。');
  if (values.login) {
    requireThat(Object.keys(values).length === 1, '-Login 请单独使用。');
    const login = await runCommand(process.execPath, [path.join(root, cliRelative), 'auth', 'login', '--human'], { timeout: 600000, interactive: true });
    requireThat(login.code === 0, '蒲公英登录未完成。'); return;
  }
  const config = loadConfig(root, values), cli = createCliRunner(root);
  if (!values.check) {
    const authentication = await cli(['auth', 'status']);
    requireThat(authentication.loggedIn === true, authenticationHint());
    if (!values.resume && config.installType === 'password') requireThat(process.env.PGYER_INSTALL_PASSWORD, '密码安装需要设置 PGYER_INSTALL_PASSWORD。');
  }
  if (!values['skip-build'] && !values.resume) {
    console.log('正在构建 APK…');
    const build = await runCommand('pwsh', ['-NoLogo', '-NoProfile', '-File', path.join(root, '构建APK.ps1')], { timeout: 600000, interactive: true });
    requireThat(build.code === 0, '构建失败，已停止发布。');
  }
  const artifact = values.resume ? null : await inspectApk(root, config);
  if (artifact) console.log(`APK 已核对：${artifact.packageName}，${artifact.versionName}（${artifact.versionCode}），签名与当前版本一致。`);
  if (values.check) {
    console.log(JSON.stringify({ checked: true, uploaded: false, installType: config.installType, channelShortcut: config.channelShortcut || null, credentialVariablesConfigured: credentialPresence(), artifact, notes: config.notes }, null, 2)); return;
  }
  const result = await publishVerifiedArtifact({ config, artifact, cli, newUpload: values['new-upload'], resumeFile: values.resume });
  console.log('发布完成：' + result.url + '\n发布记录：' + result.recordFile + '\n二维码可在安装页面查看。');
}
module.exports = { loadConfig, inspectApk, uploadArguments, createCliRunner, publishVerifiedArtifact, runCommand, cleanError, credentialPresence, authenticationHint, main };
if (require.main === module) main().catch(error => { console.error(cleanError(error.message)); process.exitCode = 1; });
