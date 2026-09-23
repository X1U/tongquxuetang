'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const project = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'voice-compat');
const base = 'http://127.0.0.1:8765';
const digest = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
const report = { pageSHA256: digest(fs.readFileSync(path.join(project, 'app/src/main/assets/index.html'))), api: [], playback: [], layouts: [], completed: false };
fs.mkdirSync(output, { recursive: true });
const request = (url, options = {}) => fetch(base + url, { signal: AbortSignal.timeout(30000), ...options });
const speechUrl = (text, rate = .85) => '/api/speech?' + new URLSearchParams({ text, rate });

function inspectWave(data) {
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WAVE');
  assert.equal(data.readUInt32LE(4) + 8, data.length);
  let format, samples;
  for (let offset = 12; offset + 8 <= data.length;) {
    const id = data.toString('ascii', offset, offset + 4), length = data.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + length <= data.length);
    if (id === 'fmt ') format = { encoding: data.readUInt16LE(offset + 8), channels: data.readUInt16LE(offset + 10), rate: data.readUInt32LE(offset + 12), bits: data.readUInt16LE(offset + 22) };
    if (id === 'data') samples = data.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  assert.deepEqual(format, { encoding: 1, channels: 1, rate: 22050, bits: 16 });
  assert.ok(samples && samples.length > 22050, 'Real audio contains more than half a second of samples');
  let peak = 0, energy = 0;
  for (let i = 0; i + 1 < samples.length; i += 2) { const sample = samples.readInt16LE(i); peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
  const result = { bytes: data.length, duration: samples.length / 44100, peak, rms: Math.sqrt(energy / (samples.length / 2)), ...format };
  assert.ok(result.peak > 100 && result.rms > 20, 'The generated waveform is not silence');
  return result;
}

async function apiChecks() {
  const status = await (await request('/api/speech/status')).json();
  assert.equal(status.available, true); assert.equal(status.engine, 'local-audio');
  report.voice = status.voice;
  const url = speechUrl('你好，我们一起来数数：一，二，三。');
  const first = await request(url), audio = Buffer.from(await first.arrayBuffer());
  assert.equal(first.status, 200); assert.match(first.headers.get('content-type'), /^audio\/wav/);
  report.api.push({ check: 'real Chinese PCM waveform', ...inspectWave(audio) });
  fs.writeFileSync(path.join(output, 'verified-chinese.wav'), audio);
  const cached = await Promise.all(Array.from({ length: 6 }, async () => Buffer.from(await (await request(url)).arrayBuffer())));
  assert.ok(cached.every(data => digest(data) === digest(audio)));
  const concurrentUrl = speechUrl('一起看图片，再选出正确的数字。');
  const concurrent = await Promise.all(Array.from({ length: 5 }, async () => Buffer.from(await (await request(concurrentUrl)).arrayBuffer())));
  assert.ok(concurrent.every(data => digest(data) === digest(concurrent[0]))); inspectWave(concurrent[0]);
  const head = await request(url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), audio.length); assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const [range, start, end] of [['bytes=0-63', 0, 64], ['bytes=-16', audio.length - 16, audio.length], ['bytes=128-', 128, audio.length]]) {
    const response = await request(url, { headers: { Range: range } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes ${start}-${end - 1}/${audio.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio.subarray(start, end));
  }
  for (const range of ['bytes=99999999-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,4-5']) assert.equal((await request(url, { headers: { Range: range } })).status, 416);
  for (const url of ['/api/speech', speechUrl(''), speechUrl('  '), speechUrl('字'.repeat(801)), speechUrl('你好', 0), speechUrl('你好', 2), '/api/speech?text=test&rate=NaN']) assert.equal((await request(url)).status, 400);
  assert.equal((await request('/api/speech', { method: 'POST' })).status, 405);
  assert.equal((await request('/server/speech-worker.ps1')).status, 404);
  const fast = inspectWave(Buffer.from(await (await request(speechUrl('请仔细数一数，这里一共有几个苹果？', 1.2))).arrayBuffer()));
  const slow = inspectWave(Buffer.from(await (await request(speechUrl('请仔细数一数，这里一共有几个苹果？', .6))).arrayBuffer()));
  assert.ok(slow.duration > fast.duration * 1.2, 'Slow speech is observably slower');
  report.api.push({ check: 'cache, concurrent requests, HEAD, byte ranges, invalid input and route isolation', passed: true }, { check: 'slow speech', fast: fast.duration, slow: slow.duration });
  console.log('PASS real Chinese WAV, non-silent PCM, cache/concurrency, HEAD/ranges, input checks and slow speech');
}

async function playback(page, selector, label, expectedText, finish = false) {
  const previous = await page.evaluate(() => window.__audioEvents.filter(item => item.type === 'playing').length);
  await page.locator(selector).tap();
  await page.waitForFunction(previous => window.__audioEvents.filter(item => item.type === 'playing').length > previous && document.querySelector('audio').currentTime > .12, previous, { timeout: 24000 });
  const state = await page.locator('audio:not(#listeningMedia)').evaluate(audio => ({ src: audio.currentSrc, time: audio.currentTime, duration: audio.duration, paused: audio.paused, readyState: audio.readyState }));
  assert.equal(state.paused, false); assert.ok(state.duration > .2); assert.ok(state.readyState >= 2);
  const text = new URL(state.src).searchParams.get('text');
  if (expectedText) assert.match(text, expectedText);
  report.playback.push({ label, text, duration: state.duration, currentTime: state.time, actualPlayingEvent: true });
  if (finish) await page.waitForFunction(() => document.querySelector('audio').ended, null, { timeout: 30000 });
  return state;
}
async function stopped(page, label) {
  assert.equal(await page.locator('audio:not(#listeningMedia)').evaluate(audio => audio.paused && !audio.getAttribute('src')), true, label);
}
async function home(page) {
  await page.locator('#backHome').tap();
  await page.waitForFunction(() => document.body.dataset.mode === 'home');
  await stopped(page, 'Returning home cancels audio');
}
async function enter(page, mode) {
  await page.locator(`[data-open-mode="${mode}"]`).tap();
  await page.waitForFunction(mode => document.body.dataset.mode === mode, mode);
}
async function cipherAnswer(page) {
  if (await page.locator('#speakAnswerView').isVisible()) return;
  if (await page.locator('#matrix .matched').count() === 3) {
    await page.locator('#matrix .matched').first().tap(); return;
  }
  for (let slot = 0; slot < 3; slot++) {
    const id = await page.evaluate(index => {
      const code = document.querySelectorAll('#codeList .code')[index], column = code.querySelector('.code-number').textContent;
      const row = window.PictureCipher.rows.findIndex(item => code.querySelector('.code-caption').textContent.includes(item.name + '色行'));
      return document.querySelector('#matrix .card[data-column="' + column + '"][data-row="' + row + '"]').dataset.card;
    }, slot);
    await page.locator('#matrix [data-card="' + id + '"]').tap();
  }
  await page.locator('#winConfirm').tap();
}
async function layout(page, tag) {
  const issues = await page.locator('.header button, #homeScreen .mode-card, #homeVoiceStatus').evaluateAll(nodes => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal overflow');
    for (const node of nodes) {
      if (!node.getClientRects().length) continue;
      const box = node.getBoundingClientRect();
      if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) issues.push(node.id || node.dataset.openMode);
      if (node.matches('button') && (box.width < 35 || box.height < 35)) issues.push('small button: ' + node.id);
    }
    return issues;
  });
  report.layouts.push({ tag, issues });
  await page.screenshot({ path: path.join(output, tag + '.png'), fullPage: true });
  assert.deepEqual(issues, [], tag);
}

async function browserChecks() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=user-gesture-required', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;
    window.__audioEvents = [];
    document.addEventListener('DOMContentLoaded', () => {
      const audio = document.querySelector('audio');
      for (const type of ['playing', 'ended', 'pause', 'error']) audio.addEventListener(type, () => window.__audioEvents.push({ type, src: audio.currentSrc, time: audio.currentTime }));
    });
  });
  try {
    await page.goto(base + '/#home');
    assert.equal(await page.evaluate(() => Boolean(window.speechSynthesis || window.SpeechSynthesisUtterance || window.AndroidTts)), false);
    await layout(page, 'home-360x640');
    await playback(page, '#homeVoiceTest', 'home audio test', /欢迎来到童趣学堂/, true);
    assert.match(await page.locator('#homeVoiceStatus').textContent(), /试播结束/);
    assert.equal(await page.locator('#homeVoiceTest').getAttribute('aria-busy'), null);
    await playback(page, '#homeVoiceTest', 'home repeat', /欢迎/);
    await enter(page, 'count'); await stopped(page, 'Entering a game stops the home audio');
    await playback(page, '#countSpeak', 'count question', /数/);
    await playback(page, '#countSpeak', 'count repeated tap', /数/);
    assert.equal(await page.locator('audio:not(#listeningMedia)').count(), 1, 'One shared player prevents overlapping playback');
    await page.locator('#countNewQuestion').tap(); await stopped(page, 'A new quantity question stops old audio');
    await playback(page, '#countObjects button:first-child', 'count an individual object', /一|1/);
    const quantity = await page.locator('#countObjects button').count();
    await playback(page, `[data-count-choice="${quantity}"]`, 'correct quantity and writing instruction', /写|对/);
    await page.locator('#writingBack').tap(); await stopped(page, 'Leaving writing stops its instruction');
    await home(page);

    await enter(page, 'shadow');
    await playback(page, '#shadowSpeak', 'shadow question', /影子/);
    await playback(page, '#shadowHint', 'shadow hint');
    await page.locator('#shadowNext').tap(); await stopped(page, 'A new shadow stops old audio');
    await playback(page, '#shadowSpeak', 'shadow next question', /影子/);
    await home(page);

    await enter(page, 'pattern');
    await playback(page, '#patternSpeak', 'pattern question', /下一张/);
    await playback(page, '#patternHint', 'pattern hint', /一组|重复|轮流/);
    await page.locator('#patternNext').tap(); await stopped(page, 'A new pattern stops old audio');
    await playback(page, '#patternSpeak', 'pattern next question', /下一张/);
    await home(page);

    await enter(page, 'cipher'); await cipherAnswer(page);
    await playback(page, '#speakAnswerView', 'cipher answer', /在/, true);
    assert.match(await page.locator('#answerViewStatus').textContent(), /再点句子/);
    assert.equal(await page.locator('#answerViewStop').isVisible(), false);
    await home(page);await page.locator('#globalRateSelect').selectOption('0.65');await enter(page,'cipher');await cipherAnswer(page);
    const slow = await playback(page, '#speakAnswerView', 'cipher slow answer', /在/);
    assert.equal(new URL(slow.src).searchParams.get('rate'), '0.65');
    await page.locator('#answerViewStop').tap(); await stopped(page, 'Cipher stop button');
    await home(page);

    await enter(page, 'sort');
    assert.equal(await page.locator('#goodsTray [data-goods-id]').count(), 9);
    await page.locator('#sortToggleAnswer').tap();
    await playback(page, '#speakSortPrompt', 'sorting question', /分类/);
    await page.locator('#sortStopSpeech').tap(); await stopped(page, 'Sorting stop button');
    await playback(page, '#speakSortReason', 'sorting explanation', /食品|玩具|服饰/);
    await playback(page, '[data-read-group]:first-child', 'sorting group explanation');
    await page.locator('#sortNext').tap(); await stopped(page, 'New goods stop the old explanation');
    await home(page);
    console.log('PASS real audio in all five games with speechSynthesis and AndroidTts absent; repeat, end, stop and navigation');

    await page.route('**/api/speech?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"SPEECH_UNAVAILABLE"}' }));
    await page.locator('#homeVoiceTest').tap();
    await page.waitForFunction(() => document.getElementById('homeVoiceStatus').textContent.includes('没播出来'));
    assert.equal(await page.locator('#homeVoiceTest').getAttribute('aria-busy'), null);
    await enter(page, 'cipher');
    await cipherAnswer(page);
    await page.locator('#speakAnswerView').tap();
    await page.waitForFunction(() => document.getElementById('answerViewStatus').textContent.includes('没播出来'));
    assert.equal(await page.locator('#answerViewStop').isVisible(), false);
    await home(page); await page.unroute('**/api/speech?**');
    await playback(page, '#homeVoiceTest', 'recovered after audio error', /欢迎/);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await stopped(page, 'Page hide cancels playback');
    assert.equal(await page.locator('#homeVoiceTest').getAttribute('aria-busy'), null, 'Returning from a hidden page does not leave a playing indicator');
    for (const viewport of [{ width: 320, height: 568 }, { width: 412, height: 840 }, { width: 760, height: 900 }]) {
      await page.setViewportSize(viewport); await layout(page, `home-${viewport.width}x${viewport.height}`);
    }
    assert.deepEqual(errors, []); report.browserErrors = errors;
    report.audioEvents = await page.evaluate(() => window.__audioEvents);
    console.log('PASS visible failure/recovery and mobile home layouts');
  } finally { await browser.close(); }
}

(async () => {
  try { await apiChecks(); await browserChecks(); report.completed = true; }
  finally { report.checkedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
