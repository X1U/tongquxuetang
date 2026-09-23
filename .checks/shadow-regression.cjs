'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const output = path.join(__dirname, 'shadow-game');
fs.mkdirSync(output, { recursive: true });
const url = pathToFileURL(path.join(__dirname, '../app/src/main/assets/index.html')).href;
const viewports = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 412, height: 840 }, { width: 412, height: 915 }, { width: 760, height: 900 }, { width: 1280, height: 900 }];
const report = [];
const selectors = '#shadowScreen button, #shadowTitle, #shadowOriginal > svg, #shadowTargetName, #shadowChoices .shadow-figure > svg, #shadowFeedback';

async function inspect(page, tag, screenshot = false, selector = selectors, scrollable = false) {
  const issues = await page.locator(selector).evaluateAll((elements, scrollable) => {
    const failures = [], name = el => el.id || el.getAttribute('aria-label') || el.className.baseVal || el.className;
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('horizontal overflow');
    for (const el of elements) {
      if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) failures.push(name(el) + ': empty');
      if (innerWidth <= 760 && !scrollable && (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1)) failures.push(name(el) + ': outside viewport');
      if (el.matches('button') && (rect.width < 35 || rect.height < 35)) failures.push(name(el) + ': small target');
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1) || /(hidden|clip|auto|scroll)/.test(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) { failures.push(name(el) + ': clipped by ' + name(parent)); break; }
      }
      if (el.matches('button') && !el.disabled && rect.top >= 0 && rect.bottom <= innerHeight) {
        for (const [x, y] of [[.5, .5], [.2, .2], [.8, .8]]) {
          const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
          if (hit && !el.contains(hit)) { failures.push(name(el) + ': covered by ' + name(hit)); break; }
        }
      }
    }
    return [...new Set(failures)];
  }, scrollable);
  report.push({ tag, issues });
  if (screenshot || issues.length) await page.screenshot({ path: path.join(output, tag + '.png'), fullPage: true });
  assert.deepEqual(issues, [], tag);
}
async function snapshot(page) {
  return page.evaluate(() => ({ target: document.getElementById('shadowOriginal').dataset.target, choices: [...document.querySelectorAll('[data-shadow-id]')].map(el => el.dataset.shadowId), score: document.getElementById('shadowProgress').textContent, correct: document.querySelector('#shadowChoices .is-correct')?.dataset.shadowId || null, clue: document.getElementById('shadowFeedback').textContent }));
}
async function inspectSilhouettes(page) {
  const silhouettes = await page.evaluate(async () => {
    const result = [];
    for (const card of window.ShadowMatching.cards) {
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(card.art);
      await img.decode();
      const canvas = document.createElement('canvas');canvas.width = 120;canvas.height = 106;
      const ctx = canvas.getContext('2d');ctx.drawImage(img, 0, 0, 120, 106);
      const rgba = ctx.getImageData(0, 0, 120, 106).data;
      result.push({ id: card.id, name: card.name, mask: Array.from({ length: 120 * 106 }, (_, i) => rgba[i * 4 + 3] > 40 ? 1 : 0) });
    }
    return result;
  });
  const comparisons = [];
  for (let i = 0; i < silhouettes.length; i++) for (let j = i + 1; j < silhouettes.length; j++) {
    const a = silhouettes[i], b = silhouettes[j]; let common = 0, union = 0;
    for (let p = 0; p < a.mask.length; p++) { common += a.mask[p] && b.mask[p] ? 1 : 0; union += a.mask[p] || b.mask[p] ? 1 : 0; }
    const iou = common / union; comparisons.push({ a: a.id, b: b.id, iou });
    assert.ok(iou < .97, 'Outlines must differ visibly: ' + a.name + '/' + b.name + ' ' + iou);
  }
  fs.writeFileSync(path.join(output, 'silhouette-comparison.json'), JSON.stringify(comparisons.sort((a, b) => b.iou - a.iou), null, 2));
  const cards = await page.evaluate(() => window.ShadowMatching.cards);
  const gallery = await page.context().browser().newPage({ viewport: { width: 1040, height: 780 } });
  await gallery.setContent('<html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#f7f8f2;font:16px "Microsoft YaHei",sans-serif;color:#263e36}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}section{background:#fff;border:1px solid #e5e0eb;border-radius:16px;padding:8px;text-align:center}.pair{display:flex;justify-content:center}.art{width:105px;height:133px}.art:last-child{filter:brightness(0);opacity:.72}p{margin:4px}</style><main>' + cards.map(card => '<section><div class="pair">' + card.art.repeat(2) + '</div><p>' + card.name + '</p></section>').join('') + '</main></html>');
  await gallery.screenshot({ path: path.join(output, 'all-shadow-pairs.png'), fullPage: true });await gallery.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
  try {
    for (const viewport of viewports) {
      const tag = viewport.width + 'x' + viewport.height, touch = viewport.width === 360, page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: touch });
      page.setDefaultTimeout(6000);const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.__shadowSpeech = []; window.__shadowStops = 0; window.AndroidTts = { speak(text, rate) { window.__shadowSpeech.push({ text, rate }); }, stop() { window.__shadowStops++; }, isReady() { return true; } }; });
      const activate = locator => touch ? locator.tap() : locator.click();
      await page.goto(url + '#home');
      assert.equal(await page.locator('[data-open-mode]').count(), 6);
      await inspect(page, tag + '-home', true, '#homeScreen button, #homeScreen .mode-cover, #homeScreen .mode-content, .header button');
      await activate(page.locator('[data-open-mode="shadow"]'));
      await page.waitForFunction(() => document.body.dataset.mode === 'shadow');
      assert.equal(await page.locator('#openShadowHelp').isVisible(), true);
      let score = 0;
      for (const level of ['easy', 'careful']) {
        if (level === 'careful') await activate(page.locator('[data-shadow-level="careful"]'));
        const seen = new Set(), rounds = viewport.width === 320 || viewport.width === 412 && viewport.height === 840 ? 16 : 4;
        for (let round = 0; round < rounds; round++) {
          const before = await snapshot(page), target = before.target;seen.add(target);
          assert.equal(before.choices.length, level === 'easy' ? 3 : 4);assert.equal(new Set(before.choices).size, before.choices.length);assert.equal(before.choices.filter(id => id === target).length, 1);
          const svgEquality = await page.evaluate(target => document.querySelector('#shadowOriginal > svg').outerHTML === document.querySelector('[data-shadow-id="' + target + '"] .shadow-figure > svg').outerHTML, target);
          assert.equal(svgEquality, true, 'The correct silhouette uses the exact original drawing');
          const filters = await page.locator('#shadowChoices .shadow-figure > svg').evaluateAll(elements => elements.map(el => getComputedStyle(el).filter));assert.ok(filters.every(filter => filter === 'brightness(0)'));
          const colorOpacity = await page.locator('#shadowChoices .shadow-color').evaluateAll(elements => elements.map(el => getComputedStyle(el).opacity));assert.ok(colorOpacity.every(opacity => opacity === '0'), 'Colors stay hidden before answering');
          const shot = viewport.width === 412 && viewport.height === 840 && round < 2 || viewport.width === 320 && round === 0;
          await inspect(page, tag + '-' + level + '-question-' + round, shot);
          if (round === 0) {
            const wrong = before.choices.find(id => id !== target);
            await activate(page.locator('[data-shadow-id="' + wrong + '"]'));
            const retry = await snapshot(page);assert.equal(retry.target, target);assert.deepEqual(retry.choices, before.choices);assert.equal(retry.score, before.score);assert.equal(retry.correct, null);
            assert.equal(await page.locator('#shadowFeedback').getAttribute('data-tone'), 'retry');
            await inspect(page, tag + '-' + level + '-retry', shot);
            await activate(page.locator('#shadowHint'));
            const clue = await page.evaluate(id => window.ShadowMatching.byId[id].clue, target);
            assert.ok((await page.locator('#shadowFeedback').textContent()).includes(clue));
            assert.equal(await page.locator('#shadowChoices .is-correct').count(), 0, 'A hint does not mark an answer correct');
            const hintSpeech = await page.evaluate(() => window.__shadowSpeech.at(-1));assert.equal(hintSpeech.text, clue);assert.equal(hintSpeech.rate, .8);
            await inspect(page, tag + '-' + level + '-hint', shot);
            const hinted = await snapshot(page);await activate(page.locator('#backHome'));await activate(page.locator('[data-open-mode="shadow"]'));assert.deepEqual(await snapshot(page), hinted, 'Returning preserves the question and hint');
          }
          await activate(page.locator('[data-shadow-id="' + target + '"]'));score++;
          assert.equal((await snapshot(page)).correct, target);assert.equal(await page.locator('#shadowProgress').textContent(), '找到 ' + score + ' 个');
          assert.equal(await page.locator('.is-correct .shadow-color').evaluate(el => getComputedStyle(el).opacity), '1');
          assert.equal(await page.locator('#shadowChoices button:disabled').count(), before.choices.length - 1);
          assert.equal(await page.locator('#shadowNextLabel').textContent(), '下一题');
          assert.equal(await page.locator('#shadowHintLabel').textContent(), '听听发现');
          await inspect(page, tag + '-' + level + '-correct-' + round, shot);
          if (round === 0) {
            await activate(page.locator('[data-shadow-id="' + target + '"]'));assert.equal(await page.locator('#shadowProgress').textContent(), '找到 ' + score + ' 个', 'A repeated correct click does not add another point');
            const solved = await snapshot(page);await activate(page.locator('#backHome'));await activate(page.locator('[data-open-mode="shadow"]'));assert.deepEqual(await snapshot(page), solved, 'Returning preserves a completed round');
            await activate(page.locator('#shadowHint'));assert.equal(await page.evaluate(() => window.__shadowSpeech.at(-1).text), solved.clue);
          }
          if (round + 1 < rounds || level === 'careful') { await activate(page.locator('#shadowNext'));assert.notEqual((await snapshot(page)).target, target, 'The next question changes the target');assert.equal(await page.locator('#shadowProgress').textContent(), '找到 ' + score + ' 个'); }
        }
        if (rounds === 16) assert.equal(seen.size, 16, 'Every picture appears once in a complete deck');
      }
      await activate(page.locator('#openShadowHelp'));assert.equal(await page.locator('#app').getAttribute('inert'), '');
      await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#startShadow').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Tab');assert.equal(await page.locator('#closeShadowHelp').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.ShadowMatchingUI.back()), true);assert.equal(await page.locator('#app').getAttribute('inert'), null);
      const target = (await snapshot(page)).target;await page.locator('[data-shadow-id="' + target + '"]').focus();await page.keyboard.press('Enter');
      assert.equal((await snapshot(page)).correct, target, 'Keyboard users can answer');
      const stops = await page.evaluate(() => window.__shadowStops);await activate(page.locator('#backHome'));await page.waitForFunction(() => document.body.dataset.mode === 'home');assert.ok(await page.evaluate(() => window.__shadowStops) > stops, 'Leaving stops speech');
      await page.goto(url + '#shadow');await page.reload();assert.equal((await snapshot(page)).target, 'plushRabbit', 'Direct shadow link opens the game');
      assert.equal(await page.locator('#shadowProgress').textContent(), '找到 0 个');
      assert.deepEqual(errors, [], 'No browser script errors');
      if (viewport.width === 412 && viewport.height === 840) await inspectSilhouettes(page);
      if (viewport.width === 760) {
        await page.setViewportSize({ width: 740, height: 360 });await inspect(page, 'landscape-easy', true, selectors, true);
        await activate(page.locator('[data-shadow-level="careful"]'));await inspect(page, 'landscape-careful', true, selectors, true);
      }
      console.log('PASS ' + tag + ': both levels, outline matching, wrong retry, hint, repeat answer, voice, return, help and ' + (touch ? 'touch' : 'mouse/keyboard'));
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
