'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const game = path.join(__dirname, '../app/src/main/assets/index.html');
const url = pathToFileURL(game).href;
const output = path.join(__dirname, 'pattern-game');
fs.mkdirSync(output, { recursive: true });
const viewports = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 412, height: 840 }, { width: 412, height: 915 }, { width: 760, height: 900 }, { width: 1280, height: 900 }];
const report = { pageSHA256: crypto.createHash('sha256').update(fs.readFileSync(game)).digest('hex').toUpperCase(), checks: [], completed: false };
const selectors = '#patternScreen button, #patternTitle, #patternSequence li, #patternSequence .art, #patternChoices .art, #patternChoices .pattern-choice-name, #patternFeedback';

async function inspect(page, tag, screenshot = false, selector = selectors, scrollable = false) {
  const issues = await page.locator(selector).evaluateAll((nodes, scrollable) => {
    const issues = [], label = node => node.id || node.getAttribute('aria-label') || node.className.baseVal || node.className;
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal overflow');
    for (const node of nodes) {
      if (!node.getClientRects().length || getComputedStyle(node).visibility === 'hidden') continue;
      const box = node.getBoundingClientRect(), name = label(node);
      if (box.width < 1 || box.height < 1) issues.push(name + ': empty');
      if (innerWidth <= 760 && !scrollable && (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1)) issues.push(name + ': outside viewport');
      if (node.matches('button') && (box.width < 35 || box.height < 35)) issues.push(name + ': small touch target');
      if (node.matches('.pattern-level, .pattern-actions button') && box.height < 44) issues.push(name + ': mode/action smaller than 44px');
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if ((/(hidden|clip|auto|scroll)/.test(style.overflowX) && (box.left < clip.left - 1 || box.right > clip.right + 1)) || (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1))) { issues.push(name + ': clipped by ' + label(parent)); break; }
      }
      if (node.matches('button') && !node.disabled && box.top >= 0 && box.bottom <= innerHeight) {
        for (const [x,y] of [[.5,.5],[.2,.2],[.8,.8]]) {
          const hit = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
          if (hit && !node.contains(hit)) { issues.push(name + ': covered'); break; }
        }
      }
    }
    return [...new Set(issues)];
  }, scrollable);
  report.checks.push({ tag, issues });
  if (screenshot || issues.length) await page.screenshot({ path: path.join(output, tag + '.png'), fullPage: true });
  assert.deepEqual(issues, [], tag);
}
async function readRound(page) {
  const ids = await page.locator('[data-pattern-item]').evaluateAll(nodes => nodes.map(node => node.dataset.patternItem));
  const periods = [1,2,3].filter(period => ids.every((id,index) => index < period || id === ids[index-period]));
  const answers = [...new Set(periods.map(period => ids[ids.length % period]))];
  assert.equal(answers.length, 1, 'The visible sequence determines one next card');
  return { ids, answer: answers[0], period: periods[0], rule: await page.locator('#patternSequence').getAttribute('data-rule') };
}
async function choose(page, id, touch = false) {
  const button = page.locator('[data-pattern-choice="' + id + '"]');
  if (touch) await button.tap(); else await button.click();
}
async function playRound(page, tag, expectedScore, { screenshot = false, touch = false, resume = false } = {}) {
  const round = await readRound(page);
  const options = await page.locator('[data-pattern-choice]').evaluateAll(nodes => nodes.map(node => node.dataset.patternChoice));
  assert.equal(new Set(options).size, 3); assert.equal(options.filter(id => id === round.answer).length, 1);
  assert.equal(await page.locator('#patternMissing .art').count(), 0);
  assert.equal(await page.locator('#patternMissing').textContent(), String(round.ids.length + 1) + '?');
  await inspect(page, tag + '-question', screenshot);
  await page.locator('#patternSpeak').click();
  const spoken = await page.evaluate(() => window.__patternSpeech.at(-1));
  assert.ok(spoken.includes('下一张是什么'));
  await choose(page, options.find(id => id !== round.answer), touch);
  assert.equal(await page.locator('#patternFeedback').getAttribute('data-tone'), 'retry');
  assert.equal(await page.locator('#patternProgress').textContent(), '找到 ' + expectedScore + ' 个规律');
  assert.deepEqual((await readRound(page)).ids, round.ids);
  await page.locator('#patternHint').click();
  assert.equal(await page.locator('#patternSequence .is-first-group').count(), round.period);
  assert.equal(await page.locator('#patternMissing .art').count(), 0, 'A hint highlights the repeating group without filling the answer');
  await inspect(page, tag + '-hint', screenshot);
  if (resume) {
    const before = await page.locator('#patternSequence').innerHTML(), hint = await page.locator('#patternFeedback').textContent();
    await page.locator('[data-pattern-level="easy"]').click();
    assert.equal(await page.locator('#patternSequence').innerHTML(), before, 'The active difficulty does not reset the question');
    const stopped = await page.evaluate(() => window.__patternStops);
    await page.locator('#backHome').click(); await page.waitForFunction(() => document.body.dataset.mode === 'home');
    assert.ok(await page.evaluate(() => window.__patternStops) > stopped, 'Leaving the game stops its voice');
    await page.locator('[data-open-mode="pattern"]').click(); await page.waitForFunction(() => document.body.dataset.mode === 'pattern');
    assert.equal(await page.locator('#patternSequence').innerHTML(), before); assert.equal(await page.locator('#patternFeedback').textContent(), hint);
  }
  await choose(page, round.answer, touch);
  assert.equal(await page.locator('#patternFeedback').getAttribute('data-tone'), 'success');
  assert.equal(await page.locator('#patternMissing .art').count(), 1);
  assert.equal(await page.locator('#patternChoices .is-correct').getAttribute('data-pattern-choice'), round.answer);
  assert.equal(await page.locator('#patternChoices button:disabled').count(), 2);
  assert.equal(await page.locator('#patternProgress').textContent(), '找到 ' + (expectedScore + 1) + ' 个规律');
  await choose(page, round.answer, touch);
  assert.equal(await page.locator('#patternProgress').textContent(), '找到 ' + (expectedScore + 1) + ' 个规律', 'Repeated correct clicks do not count again');
  assert.equal(await page.locator('#patternNextLabel').textContent(), '下一题');
  await page.locator('#patternHint').click();
  assert.equal(await page.evaluate(() => window.__patternSpeech.at(-1)), await page.locator('#patternFeedback').textContent());
  await inspect(page, tag + '-correct', screenshot);
  return round;
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
  try {
    for (const viewport of viewports) {
      const tag = viewport.width + 'x' + viewport.height;
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width === 360 });
      page.setDefaultTimeout(7000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let seed = 148932;
        Math.random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        window.__patternSpeech = []; window.__patternStops = 0;
        window.AndroidTts = { speak(text) { window.__patternSpeech.push(text); }, stop() { window.__patternStops++; }, isReady() { return true; } };
      });
      await page.goto(url + '#home');
      assert.equal(await page.locator('[data-open-mode]').count(), 6);
      await inspect(page, tag + '-home', true, '#homeScreen button, #homeScreen .mode-cover, #homeScreen .art, .header button');
      await page.locator('[data-open-mode="pattern"]').click(); await page.waitForFunction(() => document.body.dataset.mode === 'pattern');
      assert.equal(await page.locator('#openPatternHelp').isVisible(), true);
      await page.locator('#openPatternHelp').click();
      assert.equal(await page.locator('#app').getAttribute('inert'), '');
      await page.keyboard.press('Shift+Tab'); assert.equal(await page.locator('#startPattern').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Tab'); assert.equal(await page.locator('#closePatternHelp').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#app').getAttribute('inert'), null);
      let score = 0;
      await playRound(page, tag + '-ab-short', score++, { screenshot: true, touch: viewport.width === 360, resume: true });
      await page.evaluate(() => { Math.random = () => .999999; }); await page.locator('#patternNext').click();
      const long = await playRound(page, tag + '-ab-long', score++, { screenshot: viewport.width === 412 });
      assert.equal(long.ids.length, 5);
      for (const [variant, value] of [['short',0],['middle',.5],['long',.999999]]) {
        await page.locator('[data-pattern-level="easy"]').click();
        await page.evaluate(value => { Math.random = () => value; }, value);
        if (viewport.width === 360) await page.locator('[data-pattern-level="challenge"]').tap(); else await page.locator('[data-pattern-level="challenge"]').click();
        const rules = new Set();
        for (let i = 0; i < 3; i++) {
          const round = await readRound(page); rules.add(round.rule);
          assert.equal(round.ids.length, variant === 'short' ? 6 : variant === 'middle' ? 7 : 8);
          await playRound(page, tag + '-' + round.rule + '-' + variant, score++, { screenshot: variant === 'long' || viewport.width === 412 && viewport.height === 840, touch: viewport.width === 360 });
          if (i < 2) await page.locator('#patternNext').click();
        }
        assert.deepEqual([...rules].sort(), ['aab','abb','abc']);
      }
      const answer = await page.locator('#patternSequence').innerHTML(), completed = await page.locator('#patternProgress').textContent();
      await page.locator('#backHome').click(); await page.locator('[data-open-mode="pattern"]').click();
      await page.waitForFunction(() => document.body.dataset.mode === 'pattern');
      assert.equal(await page.locator('#patternSequence').innerHTML(), answer); assert.equal(await page.locator('#patternProgress').textContent(), completed);
      await page.locator('#openPatternHelp').click(); assert.equal(await page.evaluate(() => window.PatternLearningUI.back()), true);
      assert.equal(await page.evaluate(() => window.PatternLearningUI.back()), false, 'Android Back returns home when no help dialog is open');
      assert.equal(await page.locator('#app').getAttribute('inert'), null);
      await page.reload(); assert.equal(await page.locator('[data-pattern-level="challenge"]').getAttribute('aria-pressed'), 'true');
      await inspect(page, tag + '-remembered-challenge');
      await page.locator('[data-pattern-level="easy"]').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#patternSequence').getAttribute('data-rule'), 'ab');
      const keyboardRound = await readRound(page);
      await page.locator('[data-pattern-choice="' + keyboardRound.answer + '"]').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#patternFeedback').getAttribute('data-tone'), 'success');
      if (viewport.width === 412 && viewport.height === 840) {
        await page.setViewportSize({ width: 740, height: 360 }); await inspect(page, 'landscape-pattern', true, selectors, true);
        await page.locator('#backHome').click(); await page.waitForFunction(() => document.body.dataset.mode === 'home');
        await inspect(page, 'landscape-home', true, '#homeScreen button, #homeScreen .mode-cover', true);
        await page.setViewportSize(viewport);
        for (const [mode, screen] of [['cipher','cipherScreen'],['sort','classificationScreen'],['count','countScreen'],['shadow','shadowScreen']]) {
          await page.locator('[data-open-mode="' + mode + '"]').click(); await page.waitForFunction(mode => document.body.dataset.mode === mode, mode);
          assert.equal(await page.locator('#' + screen).isVisible(), true); assert.equal(await page.locator('#openPatternHelp').isVisible(), false);
          if (mode === 'sort') assert.equal(await page.locator('#goodsTray [data-goods-id]').count(), 9);
          if (mode === 'count') assert.equal(await page.locator('[data-count-order]').count(), 2);
          await page.locator('#backHome').click(); await page.waitForFunction(() => document.body.dataset.mode === 'home');
        }
        report.checks.push({ tag: 'existing-games-and-nine-goods', issues: [] });
      }
      assert.deepEqual(errors, []);
      console.log('PASS ' + tag + ': six home entries, AB/AAB/ABB/ABC at every ending, hints, errors/retries, answers, stable progress, voice, return/help, saved level');
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
      delete window.speechSynthesis;
      delete window.SpeechSynthesisUtterance;
    });
    await page.goto(url + '#pattern');
    assert.equal(await page.locator('[data-pattern-level="easy"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-pattern-level="challenge"]').click();
    await page.locator('#patternHint').click(); assert.match(await page.locator('#patternFeedback').textContent(), /没有中文声音/);
    const round = await readRound(page); await choose(page, round.answer);
    assert.equal(await page.locator('#patternFeedback').getAttribute('data-tone'), 'success');
    await inspect(page, 'no-storage-or-voice', true); assert.deepEqual(errors, []); await page.close();
    report.completed = true;
    console.log('PASS keyboard/touch play, native Back, landscape, original games and unavailable storage/voice');
  } finally {
    report.checkedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
