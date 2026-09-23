'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'number-game');
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
const source = fs.readFileSync(path.join(project, 'app/src/main/assets/index.html'));

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
  const addresses = Object.entries(os.networkInterfaces()).filter(([name]) => !/loopback|virtual|vmware|vbox|wsl|vpn|tailscale|vethernet/i.test(name)).flatMap(([, entries]) => entries || []).filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => entry.address);
  const urls = ['http://127.0.0.1:8765/', ...addresses.map(address => 'http://' + address + ':8765/')];
  const previews = await Promise.all(urls.map(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const page = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200); assert.equal(digest(page), digest(source), 'Preview serves the current game');
    assert.match(response.headers.get('cache-control'), /no-store/);
    return { url, status: response.status, pageMatches: true, sha256: digest(page) };
  }));
  fs.writeFileSync(path.join(output, 'preview-verification.json'), JSON.stringify(previews, null, 2));
  if (process.argv.includes('--preview-only')) { console.log(JSON.stringify(previews, null, 2)); return; }
  const standalone = fs.readFileSync(path.resolve(project, '../密码图卡乐园/密码图卡乐园.html'));
  assert.equal(digest(standalone), digest(source), 'Standalone web edition matches Android assets');
  const apkPath = 'app/build/outputs/apk/debug/app-debug.apk', apk = fs.readFileSync(path.join(project, apkPath)), zip = readZip(apk);
  for (const file of ['assets/index.html', 'classes.dex', 'AndroidManifest.xml', 'resources.arsc']) assert.ok(zip.entries.has(file));
  assert.equal(digest(zip.extract('assets/index.html')), digest(source), 'APK contains the current game');
  const dexNames = [...zip.entries.keys()].filter(name => /^classes\d*\.dex$/.test(name));
  if (process.argv.includes('--inspect-apk')) {
    for (const name of dexNames) console.log(name, zip.extract(name).toString('latin1').match(/[ -~]{10,}/g).filter(text => /NumberLearning|cipherScreen|location.hash/.test(text)));
    return;
  }
  assert.ok(dexNames.some(name => zip.extract(name).includes(Buffer.from('NumberLearningUI.back'))), 'The APK includes the new native Back handling in ' + dexNames.join(', '));
  const badging = execFileSync(path.join(project, '.tools/android-sdk/build-tools/35.0.0/aapt.exe'), ['dump', 'badging', apkPath], { cwd: project, encoding: 'utf8', windowsHide: true });
  assert.match(badging, /name='com\.picturecard\.learning' versionCode='4' versionName='1\.3'/);
  assert.match(badging, /sdkVersion:'23'/);
  const java = 'C:/Users/admin/.jdks/ms-17.0.15/bin/java.exe';
  const signer = path.join(project, '.tools/android-sdk/build-tools/35.0.0/lib/apksigner.jar');
  function certificate(file) {
    const signature = execFileSync(java, ['-jar', signer, 'verify', '--print-certs', file], { cwd: project, encoding: 'utf8', windowsHide: true });
    const fingerprint = signature.match(/certificate SHA-256 digest:\s*([0-9a-f]{64})/i);
    assert.ok(fingerprint, 'APK signature is verified');
    return fingerprint[1].toLowerCase();
  }
  const certificateSHA256 = certificate(apkPath);
  assert.equal(certificateSHA256, certificate('.checks/before-number-game-20260914.apk'), 'The update keeps the 1.2 signing identity');
  assert.equal(certificateSHA256, '9b40776f4663893287153ec7e6d1a1686b21f9350d5a3a9740a1ad36f504c667');
  const numberChecks = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  const originalChecks = JSON.parse(fs.readFileSync(path.join(__dirname, 'all-goods/report.json'), 'utf8'));
  assert.equal(numberChecks.length, 195); assert.equal(originalChecks.length, 235);
  assert.ok([...numberChecks, ...originalChecks].every(check => check.issues.length === 0));
  const result = {
    versionName: '1.3', versionCode: 4, packageName: 'com.picturecard.learning',
    apkPath: path.join(project, apkPath), bytes: apk.length,
    pageSHA256: digest(source), apkSHA256: digest(apk), allPagesMatch: true,
    certificateSHA256, sameSigningCertificate: true,
    numberUIStates: numberChecks.length, originalUIStates: originalChecks.length,
    previews, verifiedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(output, 'apk-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
