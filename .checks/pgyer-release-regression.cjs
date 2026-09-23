'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { loadConfig, inspectApk, createCliRunner, publishVerifiedArtifact, credentialPresence, authenticationHint, cleanError } = require('../scripts/pgyer-release.cjs');
const project = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'pgyer-publish');
const runDirectory = path.join(output, 'run-' + Date.now());
fs.mkdirSync(runDirectory, { recursive: true });
const report = { completed: false, realPgyerUpload: false, cli: '@pgyer/cli@0.1.5', checks: [] };
const jobs = new Map(); let active, nextKey = 1, tokenCalls = 0, fileCalls = 0, statusCalls = 0;
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks), url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/apiv2/app/getCOSToken') {
      tokenCalls++; assert.equal(req.method, 'POST');
      const form = new URLSearchParams(body.toString());
      assert.equal(form.get('_api_key'), 'TEST_ONLY_LOCAL_KEY');
      assert.equal(form.get('buildType'), 'android');
      assert.equal(form.get('buildInstallType'), '1', 'Public access is explicitly sent to the official API');
      assert.equal(form.has('buildPassword'), false, 'An unrelated password environment variable does not change public access');
      for (const field of ['username', 'password', 'PGY_USERNAME', 'PGY_PASSWORD']) assert.equal(form.has(field), false, 'Account credentials are not upload parameters');
      assert.equal(body.includes(Buffer.from('ACCOUNT_ONLY_')), false, 'Account credentials are never substituted for the API key');
      assert.equal(form.get('buildUpdateDescription'), active.notes, 'Unicode, newlines and shell-like text survive unchanged');
      assert.equal(form.get('buildChannelShortcut') || '', active.channel || '');
      if (active.tokenFailure) { json(res, 200, { code: 1002, message: 'Invalid API key: TEST_ONLY_LOCAL_KEY signed-secret-do-not-log' }); return; }
      const key = 'fixture-upload-' + nextKey++, job = { key, scenario: active, polls: 0 }; jobs.set(key, job); active.job = job;
      json(res, 200, { code: 0, data: { key, endpoint: 'http://127.0.0.1:' + server.address().port + '/storage/' + key, params: { key, signature: 'fixture-signature', 'x-cos-security-token': 'fixture-security-token' } } }); return;
    }
    if (url.pathname.startsWith('/storage/')) {
      fileCalls++; const job = jobs.get(url.pathname.split('/').at(-1)); assert.ok(job);
      assert.equal(req.method, 'POST'); assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
      assert.ok(body.includes(fs.readFileSync(job.scenario.artifact.apkPath)), 'The real verified APK is streamed in the multipart upload');
      assert.ok(body.includes(Buffer.from('fixture-signature')) && body.includes(Buffer.from('fixture-security-token')));
      if (job.scenario.storageFailure) { res.writeHead(503); res.end('signed-secret-do-not-log'); return; }
      res.writeHead(204); res.end(); return;
    }
    if (url.pathname === '/apiv2/app/buildInfo') {
      statusCalls++; assert.equal(req.method, 'GET'); assert.equal(url.searchParams.get('_api_key'), 'TEST_ONLY_LOCAL_KEY');
      const job = jobs.get(url.searchParams.get('buildKey')); assert.ok(job); job.polls++;
      if (job.scenario.pending || job.polls <= 2) { json(res, 200, { code: 1247, message: '正在发布中' }); return; }
      const artifact = job.scenario.artifact;
      json(res, 200, { code: 0, data: { appKey: 'fixture-app', buildKey: 'fixture-build', buildBuildVersion: 9, buildName: '图卡学习乐园', buildVersion: artifact.versionName, buildVersionNo: artifact.versionCode, buildIdentifier: job.scenario.wrongPackage ? 'unexpected.package' : artifact.packageName, buildShortcutUrl: 'fixture-game', buildQRCodeURL: 'https://www.pgyer.com/app/qrcode/fixture-game' } }); return;
    }
    json(res, 404, { code: 404 });
  } catch (error) { report.serverError = error.message; json(res, 500, { code: 500, message: error.message }); }
});
function scenario(name, artifact, options = {}) {
  const caseProject = path.join(runDirectory, name); fs.mkdirSync(caseProject, { recursive: true });
  active = { notes: '发布检查：' + name + '\n保留中文、换行、$(literal) 和 `literal`。', artifact, ...options };
  const config = { ...loadConfig(project), notes: active.notes, channelShortcut: active.channel || '', processingTimeoutSeconds: 10, pollIntervalSeconds: .03 };
  return { caseProject, current: active, config };
}
function passed(name) { report.checks.push({ name, passed: true }); console.log('PASS ' + name); }

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const fakeHome = path.join(runDirectory, 'cli-home');
    fs.mkdirSync(path.join(fakeHome, '.config/pgyer'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.config/pgyer/config.json'), JSON.stringify({ apiKey: 'TEST_ONLY_LOCAL_KEY', apiUrl: 'http://127.0.0.1:' + server.address().port }));
    const preload = path.join(runDirectory, 'cli-fixture.cjs');
    fs.writeFileSync(preload, 'require("node:os").homedir = () => ' + JSON.stringify(fakeHome) + ';\nprocess.env.PGYER_API_KEY = "TEST_ONLY_LOCAL_KEY";\nprocess.env.PGY_USERNAME = "ACCOUNT_ONLY_USER";\nprocess.env.PGY_PASSWORD = "ACCOUNT_ONLY_PASSWORD";\nprocess.env.PGYER_INSTALL_PASSWORD = "SHOULD_NOT_CHANGE_PUBLIC";\n');
    const cli = createCliRunner(project, ['--require', preload]);
    const config = loadConfig(project); assert.equal(config.installType, 'public');
    const accountOnly = { PGY_USERNAME: 'ACCOUNT_ONLY_USER', PGY_PASSWORD: 'ACCOUNT_ONLY_PASSWORD' };
    assert.deepEqual(credentialPresence(accountOnly), { PGY_USERNAME: true, PGY_PASSWORD: true, PGYER_API_KEY: false });
    assert.match(authenticationHint(accountOnly), /账号密码不能直接用于蒲公英上传 API/);
    assert.equal(authenticationHint(accountOnly).includes(accountOnly.PGY_PASSWORD), false);
    const savedAccount = Object.fromEntries(['PGY_USERNAME', 'PGY_PASSWORD'].map(name => [name, process.env[name]]));
    try {
      process.env.PGY_USERNAME = 'ACCOUNT_ONLY_'; process.env.PGY_PASSWORD = 'ACCOUNT_ONLY_secret/+&';
      const hidden = cleanError(process.env.PGY_USERNAME + ' ' + process.env.PGY_PASSWORD + ' ' + encodeURIComponent(process.env.PGY_PASSWORD));
      assert.equal(hidden, '[已隐藏] [已隐藏] [已隐藏]');
    } finally {
      for (const [name, value] of Object.entries(savedAccount)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
    passed('Named account variables are presence-only diagnostics and both raw and encoded credentials are redacted');
    const artifact = await inspectApk(project, config); report.artifact = artifact;
    passed('Current APK: package, version, embedded page and original signing certificate');
    await assert.rejects(() => inspectApk(project, { ...config, packageName: 'wrong.package' }), /包名/);
    await assert.rejects(() => inspectApk(project, { ...config, certificateSHA256: '0'.repeat(64) }), /签名/);
    const staleProject = path.join(runDirectory, 'stale-page'); fs.mkdirSync(path.join(staleProject, 'app/src/main/assets'), { recursive: true });
    fs.writeFileSync(path.join(staleProject, 'app/src/main/assets/index.html'), 'Different source');
    await assert.rejects(() => inspectApk(staleProject, { ...config, apkPath: artifact.apkPath }), /不是当前版本/);
    passed('Wrong package, wrong certificate and stale embedded page are rejected before upload');

    let test = scenario('success', artifact, { channel: 'already-created-channel' });
    const success = await publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} });
    assert.equal(success.status, 'published'); assert.equal(success.url, 'https://www.pgyer.com/fixture-game'); assert.equal(success.installType, 'public');
    assert.ok(test.current.job.polls >= 3, 'HTTP 204 is followed by pending polls and publication confirmation');
    assert.deepEqual(fs.readFileSync(path.resolve(test.caseProject, success.artifact.archivedApk)), fs.readFileSync(artifact.apkPath));
    const serialized = fs.readFileSync(success.recordFile, 'utf8');
    for (const secret of ['TEST_ONLY_LOCAL_KEY', 'ACCOUNT_ONLY_USER', 'ACCOUNT_ONLY_PASSWORD', 'fixture-signature', 'fixture-security-token', 'SHOULD_NOT_CHANGE_PUBLIC']) assert.equal(serialized.includes(secret), false);
    passed('Official CLI: real multipart APK upload, explicit public access, existing channel, 1247 polling and final link');
    const beforeDuplicate = tokenCalls;
    await publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} });
    assert.equal(tokenCalls, beforeDuplicate);
    passed('Identical successful artifact and settings do not upload twice');

    test = scenario('timeout-resume', artifact, { pending: true }); test.config.processingTimeoutSeconds = .25;
    await assert.rejects(() => publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} }), /尚未确认发布完成/);
    const beforeResume = tokenCalls; test.current.pending = false; test.config.processingTimeoutSeconds = 10;
    const resumed = await publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} });
    assert.equal(resumed.status, 'published'); assert.equal(tokenCalls, beforeResume);
    await publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact: null, cli, resumeFile: resumed.recordFile, log() {} });
    assert.equal(tokenCalls, beforeResume);
    passed('Processing timeout saves the upload key; retry and explicit resume query the same upload');

    test = scenario('token-failure', artifact, { tokenFailure: true });
    const filesBefore = fileCalls;
    await assert.rejects(() => publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} }), error => /认证失败/.test(error.message) && !/TEST_ONLY_LOCAL_KEY|signed-secret/.test(error.message));
    assert.equal(fileCalls, filesBefore);
    passed('Authentication rejection prevents file upload and never prints the raw vendor error');

    test = scenario('storage-failure', artifact, { storageFailure: true });
    await assert.rejects(() => publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} }), error => /上传结果尚未确认/.test(error.message) && !/signed-secret/.test(error.message));
    const beforeRetry = tokenCalls;
    await assert.rejects(() => publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} }), /后台核对/);
    assert.equal(tokenCalls, beforeRetry);
    passed('Uncertain storage upload stops; a repeated command cannot silently create another version');

    test = scenario('wrong-result', artifact, { wrongPackage: true });
    await assert.rejects(() => publishVerifiedArtifact({ project: test.caseProject, config: test.config, artifact, cli, log() {} }), /包名或版本/);
    assert.equal(fs.existsSync(path.join(test.caseProject, '.releases/pgyer/latest.json')), false);
    passed('Unexpected published package cannot be reported as success');
    assert.equal(report.serverError, undefined); report.requests = { tokenCalls, fileCalls, statusCalls }; report.completed = true;
  } finally {
    await new Promise(resolve => server.close(resolve)); report.checkedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
