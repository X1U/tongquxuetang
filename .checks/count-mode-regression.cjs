'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const game = path.join(__dirname, '../app/src/main/assets/index.html');
const url = pathToFileURL(game).href + '#count';
const preference = 'picture-learning-count-order';
const output = path.join(__dirname, 'number-modes');
fs.mkdirSync(output, { recursive: true });
const viewports = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 412, height: 840 }, { width: 412, height: 915 }, { width: 760, height: 900 }, { width: 1280, height: 900 }];
const report = { pageSHA256: crypto.createHash('sha256').update(fs.readFileSync(game)).digest('hex').toUpperCase(), checks: [], completed: false };
const number = page => page.locator('#countObjects button').count();
const orderButton = (page, order) => page.locator('[data-count-order="' + order + '"]');

async function selected(page, order) {
  assert.equal(await orderButton(page, order).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#countOrder [aria-pressed="true"]').count(), 1);
}
async function inspect(page, tag, screenshot = false, scrollable = false) {
  const issues = await page.locator('#countScreen button, #countObjects .art, #countFeedback, #countTitle').evaluateAll((nodes, scrollable) => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal overflow');
    for (const node of nodes) {
      if (!node.getClientRects().length) continue;
      const box = node.getBoundingClientRect(), name = node.id || node.getAttribute('aria-label') || node.className;
      if (box.width < 1 || box.height < 1) issues.push(name + ': empty');
      if (innerWidth <= 760 && !scrollable && (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1)) issues.push(name + ': outside viewport');
      if (node.matches('[data-count-order]') && (box.height < 44 || box.width < 44)) issues.push(name + ': small mode button');
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if ((/(hidden|clip|auto|scroll)/.test(style.overflowX) && (box.left < clip.left - 1 || box.right > clip.right + 1)) || (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1))) {
          issues.push(name + ': clipped'); break;
        }
      }
      if (node.matches('button') && !node.disabled && box.top >= 0 && box.bottom <= innerHeight) {
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (hit && !node.contains(hit)) issues.push(name + ': covered');
      }
    }
    return [...new Set(issues)];
  }, scrollable);
  report.checks.push({ tag, issues });
  if (screenshot || issues.length) await page.screenshot({ path: path.join(output, tag + '.png'), fullPage: true });
  assert.deepEqual(issues, [], tag);
}
async function writeCurrentGlyph(page) {
  await page.waitForFunction(() => document.getElementById('writingDemoLabel').textContent === '看示范');
  const guides = page.locator('#writingGuides .trace-guide');
  for (let i = 0; i < await guides.count(); i++) {
    const points = await guides.nth(i).evaluate(node => {
      const length = node.getTotalLength(), count = Math.ceil(length / 8), matrix = node.getScreenCTM();
      return Array.from({ length: count + 1 }, (_, step) => {
        const local = node.getPointAtLength(length * step / count);
        const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      });
    });
    await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  }
  assert.equal(await page.locator('#writingNext').isEnabled(), true);
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
  try {
    for (const viewport of viewports) {
      const tag = viewport.width + 'x' + viewport.height;
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width === 360 });
      page.setDefaultTimeout(8000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let seed = 912347;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        window.__modeSpeech = []; window.__modeStops = 0;
        window.AndroidTts = { speak(text) { window.__modeSpeech.push(text); }, stop() { window.__modeStops++; }, isReady() { return true; } };
      });
      await page.goto(url);
      assert.equal(await page.locator('[data-count-order]').count(), 2);
      await selected(page, 'sequential'); assert.equal(await number(page), 1);
      await inspect(page, tag + '-sequential', true);
      await page.locator('#countNewQuestion').click(); assert.equal(await number(page), 2);
      await page.locator('#countObjects button').first().click();
      await orderButton(page, 'sequential').click();
      assert.equal(await number(page), 2, 'Selecting the active order does not change the question');
      assert.equal(await page.locator('#countObjects [aria-pressed="true"]').count(), 1);
      const stopped = await page.evaluate(() => window.__modeStops);
      if (viewport.width === 360) await orderButton(page, 'random').tap(); else await orderButton(page, 'random').click();
      await selected(page, 'random'); assert.notEqual(await number(page), 2);
      assert.ok(await page.evaluate(() => window.__modeStops) > stopped);
      assert.equal(await page.locator('#countObjects [aria-pressed="true"]').count(), 0);
      const seen = [];
      for (let i = 0; i < 20; i++) {
        const current = await number(page); seen.push(current);
        assert.ok(current >= 1 && current <= 10);
        if (i) assert.notEqual(current, seen[i - 1], 'Adjacent random questions differ');
        const choices = await page.locator('[data-count-choice]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.countChoice)));
        assert.equal(new Set(choices).size, 3); assert.ok(choices.includes(current));
        await inspect(page, tag + '-random-' + i + '-number-' + current, i === 0 || current === 10);
        if (i < 19) await page.locator('#countNewQuestion').click();
      }
      for (const cycle of [seen.slice(0, 10), seen.slice(10)]) assert.deepEqual(cycle.slice().sort((a, b) => a - b), [1,2,3,4,5,6,7,8,9,10]);
      assert.notDeepEqual(seen.slice(0, 10), [1,2,3,4,5,6,7,8,9,10], 'Seeded random practice differs from sequential practice');
      let current = await number(page);
      await page.locator('[data-count-choice]').filter({ hasNotText: new RegExp('^' + current + '$') }).first().click();
      assert.equal(await number(page), current); assert.equal(await page.locator('#writingLesson').isVisible(), false);
      await page.locator('#countObjects button').first().click();
      const before = await page.locator('#countObjects').innerHTML();
      await orderButton(page, 'random').click(); assert.equal(await page.locator('#countObjects').innerHTML(), before);
      await page.locator('#backHome').click(); await page.locator('[data-open-mode="count"]').click();
      await page.waitForFunction(() => document.body.dataset.mode === 'count');
      await selected(page, 'random'); assert.equal(await page.locator('#countObjects').innerHTML(), before);
      await inspect(page, tag + '-random-resume');

      // Both components of 10 must still be taught when reached in random order.
      const completeTen = viewport.width === 412 && viewport.height === 840;
      if (completeTen) {
        for (let i = 0; await number(page) !== 10 && i < 10; i++) await page.locator('#countNewQuestion').click();
        assert.equal(await number(page), 10); current = 10;
      }
      await page.locator('[data-count-choice="' + current + '"]').click();
      assert.equal(await page.locator('#writingLesson').isVisible(), true);
      assert.equal(await page.locator('#countOrder').isVisible(), false, 'Mode choices do not crowd the writing board');
      assert.equal(await page.locator('#countTitle').textContent(), '学写 ' + current);
      await inspect(page, tag + '-random-write', true);
      if (completeTen) {
        await writeCurrentGlyph(page); assert.match(await page.locator('#writingNext').textContent(), /接着写 0/);
        assert.match(await page.locator('#countRange').textContent(), /已学 0\/10/);
        await page.locator('#writingNext').click(); await writeCurrentGlyph(page);
        assert.match(await page.locator('#countRange').textContent(), /已学 1\/10/);
        await page.locator('#writingNext').click(); await selected(page, 'random');
        assert.notEqual(await number(page), 10, 'Finishing the random lesson advances within random mode');
      } else {
        assert.equal(await page.evaluate(() => window.NumberLearningUI.back()), true);
        assert.equal(await number(page), current); await selected(page, 'random');
      }
      const learned = await page.locator('#countRange').textContent();
      await orderButton(page, 'sequential').focus(); await page.keyboard.press('Enter');
      await selected(page, 'sequential'); assert.equal(await number(page), 1);
      assert.equal(await page.locator('#countRange').textContent(), learned, 'Switching order preserves completed learning');
      assert.equal(await page.locator('#countContinue').isVisible(), false);
      assert.equal(await page.locator('#writingInk path').count(), 0, 'A new order starts a clean lesson');
      for (let expected = 2; expected <= 11; expected++) { await page.locator('#countNewQuestion').click(); assert.equal(await number(page), (expected - 1) % 10 + 1); }
      await orderButton(page, 'random').focus(); await page.keyboard.press('Space'); await selected(page, 'random');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), preference), 'random');
      await page.reload(); await selected(page, 'random');
      await inspect(page, tag + '-saved-random');
      await orderButton(page, 'sequential').click(); await page.reload();
      await selected(page, 'sequential'); assert.equal(await number(page), 1);
      await page.locator('#openCountHelp').click();
      const help = await page.locator('.count-help-range').textContent();
      assert.ok(help.includes('顺序数字') && help.includes('随机数字'));
      assert.equal(await page.evaluate(() => window.NumberLearningUI.back()), true);
      if (viewport.width === 412 && viewport.height === 840) {
        await page.setViewportSize({ width: 740, height: 360 });
        await orderButton(page, 'random').click(); await inspect(page, 'landscape-random', true, true);
        await page.setViewportSize(viewport);
        await page.locator('#backHome').click();
        await page.locator('[data-open-mode="shadow"]').click();
        await page.waitForFunction(() => document.body.dataset.mode === 'shadow');
        assert.equal(await page.locator('#shadowChoices button').count(), 3);
        await page.locator('#backHome').click(); await page.locator('[data-open-mode="sort"]').click();
        await page.waitForFunction(() => document.body.dataset.mode === 'sort');
        assert.equal(await page.locator('#goodsTray [data-goods-id]').count(), 9);
        await page.locator('#backHome').click(); await page.locator('[data-open-mode="cipher"]').click();
        await page.waitForFunction(() => document.body.dataset.mode === 'cipher');
        assert.equal(await page.locator('#cipherScreen').isVisible(), true);
        report.checks.push({ tag: 'original-games-smoke', issues: [] });
      }
      assert.deepEqual(errors, []);
      console.log('PASS ' + tag + ': sequential cycle, two random cycles, same-button stability, switching, retries, writing, return, saved choice');
      await page.close();
    }
    for (const blocked of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ blocked, preference }) => {
        if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
        else localStorage.setItem(preference, 'invalid-old-value');
      }, { blocked, preference });
      await page.goto(url); await selected(page, 'sequential');
      await orderButton(page, 'random').click(); await selected(page, 'random');
      assert.ok(await number(page) >= 1 && await number(page) <= 10);
      await inspect(page, blocked ? 'storage-unavailable' : 'invalid-preference');
      assert.deepEqual(errors, []); await page.close();
    }
    report.completed = true;
    console.log('PASS storage fallback, original game navigation, random two-part 10, keyboard/touch mode choice and landscape');
  } finally {
    report.checkedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
