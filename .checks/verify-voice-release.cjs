'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'voice-compat');
const digest = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
const sourcePath = path.join(project, 'app/src/main/assets/index.html');
const source = fs.readFileSync(sourcePath), sourceTime = fs.statSync(sourcePath).mtimeMs;

function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'APK has a ZIP directory');
  const count = buffer.readUInt16LE(end + 10), entries = new Map();
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, { method: buffer.readUInt16LE(offset + 10), size: buffer.readUInt32LE(offset + 20), local: buffer.readUInt32LE(offset + 42) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, extract(name) {
    const entry = entries.get(name); assert.ok(entry, name + ' is packaged');
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    const content = buffer.subarray(start, start + entry.size);
    assert.ok([0, 8].includes(entry.method));
    return entry.method === 8 ? zlib.inflateRawSync(content) : content;
  } };
}

(async () => {
  const standalone = path.resolve(project, '../密码图卡乐园');
  assert.equal(digest(fs.readFileSync(path.join(standalone, '密码图卡乐园.html'))), digest(source));
  for (const file of ['手机预览.cjs', 'server/speech-service.cjs', 'server/speech-worker.ps1']) assert.equal(digest(fs.readFileSync(path.join(project, file))), digest(fs.readFileSync(path.join(standalone, file))), file + ' is synchronized');
  const addresses = Object.entries(os.networkInterfaces()).filter(([name]) => !/loopback|virtual|vmware|vbox|wsl|vpn|tailscale|vethernet/i.test(name)).flatMap(([, entries]) => entries || []).filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => entry.address);
  const previews = await Promise.all(['127.0.0.1', ...addresses].map(async address => {
    const url = 'http://' + address + ':8765/';
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, 200); assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(source));
    assert.match(response.headers.get('cache-control'), /no-store/);
    const status = await (await fetch(url + 'api/speech/status', { signal: AbortSignal.timeout(8000) })).json();
    assert.equal(status.available, true); assert.equal(status.engine, 'local-audio');
    return { url, pageMatches: true, voiceAvailable: true, voice: status.voice };
  }));
  const voice = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  assert.equal(voice.completed, true); assert.equal(voice.pageSHA256, digest(source));
  assert.ok(voice.playback.length >= 18); assert.deepEqual(voice.browserErrors, []);
  assert.ok(voice.layouts.every(check => check.issues.length === 0));
  const regressions = {};
  for (const [name, expected] of [['number-game', 195], ['number-modes', 148], ['pattern-game', 214], ['shadow-game', null], ['all-goods', null]]) {
    const file = path.join(__dirname, name, 'report.json'), report = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(fs.statSync(file).mtimeMs >= sourceTime, name + ' was checked after the final page change');
    const checks = Array.isArray(report) ? report : report.checks;
    if (!Array.isArray(report)) { assert.equal(report.completed, true); assert.equal(report.pageSHA256, digest(source)); }
    assert.ok(checks.length > 0 && checks.every(check => (check.issues || check.failures || []).length === 0));
    if (expected !== null) assert.equal(checks.length, expected);
    regressions[name] = checks.length;
  }
  const apkPath = path.join(project, 'app/build/outputs/apk/debug/app-debug.apk'), apk = fs.readFileSync(apkPath), zip = readZip(apk);
  for (const file of ['assets/index.html', 'classes.dex', 'AndroidManifest.xml', 'resources.arsc']) assert.ok(zip.entries.has(file));
  assert.equal(digest(zip.extract('assets/index.html')), digest(source));
  const dexNames = [...zip.entries.keys()].filter(name => /^classes\d*\.dex$/.test(name));
  for (const bridge of ['PatternLearningUI.back', 'ShadowMatchingUI.back', 'NumberLearningUI.back']) assert.ok(dexNames.some(name => zip.extract(name).includes(Buffer.from(bridge))));
  const badging = execFileSync(path.join(project, '.tools/android-sdk/build-tools/35.0.0/aapt.exe'), ['dump', 'badging', path.relative(project, apkPath)], { cwd: project, encoding: 'utf8', windowsHide: true });
  assert.match(badging, /name='com\.picturecard\.learning' versionCode='8' versionName='1\.7'/); assert.match(badging, /sdkVersion:'23'/);
  const signer = path.join(project, '.tools/android-sdk/build-tools/35.0.0/lib/apksigner.jar');
  function certificate(file) {
    const signature = execFileSync('C:/Users/admin/.jdks/ms-17.0.15/bin/java.exe', ['-jar', signer, 'verify', '--print-certs', file], { cwd: project, encoding: 'utf8', windowsHide: true });
    const fingerprint = signature.match(/certificate SHA-256 digest:\s*([0-9a-f]{64})/i); assert.ok(fingerprint);
    return fingerprint[1].toLowerCase();
  }
  const certificateSHA256 = certificate(apkPath);
  assert.equal(certificateSHA256, certificate(path.join(__dirname, 'before-voice-compat-20260914.apk')));
  assert.equal(certificateSHA256, '9b40776f4663893287153ec7e6d1a1686b21f9350d5a3a9740a1ad36f504c667');
  const result = { versionName: '1.7', versionCode: 8, apkPath, bytes: apk.length, apkSHA256: digest(apk), pageSHA256: digest(source), certificateSHA256, sameSigningCertificate: true, actualAudioCases: voice.playback.length, regressions, previews, verifiedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, 'apk-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
