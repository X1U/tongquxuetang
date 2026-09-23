'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const gameFile = path.join(__dirname, '../app/src/main/assets/index.html');
const url = pathToFileURL(gameFile).href;
const output = path.join(__dirname, 'number-game');
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(gameFile, 'utf8');
const scripts = [...html.matchAll(/<script id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 14);
scripts.forEach(script => new vm.Script(script[2], { filename: script[1] }));
const viewports = [
  { width: 320, height: 568 }, { width: 360, height: 640 },
  { width: 412, height: 840 }, { width: 412, height: 915 },
  { width: 760, height: 900 }, { width: 1280, height: 900 }
];
const report = [];
const targets = '#countScreen button, #countTitle, #countObjects .art, #writingStrokeNote, #writingSvg, #writingFeedback, #countFeedback';

async function inspect(page, tag, screenshot = false, selectors = targets, scrollable = false) {
  const issues = await page.locator(selectors).evaluateAll((elements, scrollable) => {
    const issues = [], name = el => el.id || el.getAttribute('aria-label') || el.className.baseVal || el.className;
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal overflow');
    for (const el of elements) {
      if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) issues.push(name(el) + ': empty');
      if (innerWidth <= 760 && !scrollable && (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1)) issues.push(name(el) + ': outside viewport');
      if (el.matches('button') && (box.width < 40 || box.height < 35)) issues.push(name(el) + ': small touch target');
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        const x = /(hidden|clip|auto|scroll)/.test(style.overflowX) && (box.left < clip.left - 1 || box.right > clip.right + 1);
        const y = /(hidden|clip|auto|scroll)/.test(style.overflowY) && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1);
        if (x || y) { issues.push(name(el) + ': clipped by ' + name(parent)); break; }
      }
      if (el.matches('button') && !el.disabled && box.top >= 0 && box.bottom <= innerHeight) {
        for (const [x, y] of [[.5, .5], [.2, .2], [.8, .8]]) {
          const hit = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
          if (hit && !el.contains(hit)) { issues.push(name(el) + ': covered by ' + name(hit)); break; }
        }
      }
    }
    return [...new Set(issues)];
  }, scrollable);
  report.push({ tag, issues });
  if (screenshot || issues.length) await page.screenshot({ path: path.join(output, tag + '.png'), fullPage: true });
  assert.deepEqual(issues, [], tag);
}

async function readyToTrace(page) {
  await page.waitForFunction(() => document.getElementById('writingDemoLabel').textContent === '看示范');
  assert.equal(await page.locator('#writingLesson').isVisible(), true);
}
async function strokePoints(page, index, step = 10) {
  return page.locator('#writingGuides .trace-guide').nth(index).evaluate((node, step) => {
    const length = node.getTotalLength(), count = Math.ceil(length / step), matrix = node.getScreenCTM();
    return Array.from({ length: count + 1 }, (_, i) => {
      const local = node.getPointAtLength(length * i / count);
      const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      // Small natural deviations still count as tracing the number.
      const jitter = i && i < count ? Math.sin(i * .8) * matrix.a * 2 : 0;
      return { x: point.x + jitter, y: point.y - jitter };
    });
  }, step);
}
async function drag(page, points, touch) {
  if (touch) {
    const point = p => ({ x: p.x, y: p.y, radiusX: 5, radiusY: 5, force: .6 });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(points[0])] });
    for (const p of points.slice(1)) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(p)] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  }
}
async function writeGlyph(page, digit, touch) {
  const expected = ['4', '5'].includes(digit) ? 2 : 1;
  assert.equal(await page.locator('#writingGuides .trace-guide').count(), expected, 'The digit has the expected stroke count');
  for (let stroke = 0; stroke < expected; stroke++) {
    await drag(page, await strokePoints(page, stroke), touch);
    if (stroke < expected - 1) {
      assert.equal(await page.locator('#writingNext').isDisabled(), true, 'One stroke does not finish a two-stroke digit');
      assert.match(await page.locator('#writingStrokeNote').textContent(), /第 2/);
    }
  }
  assert.equal(await page.locator('#writingNext').isEnabled(), true, 'Tracing every stroke completes ' + digit + ': ' + await page.locator('#writingFeedback').textContent());
  assert.match(await page.locator('#writingFeedback').textContent(), /写好|都练过/);
  assert.equal(await page.locator('#writingPen').isVisible(), false, 'The start marker is hidden after writing');
}
async function learnRound(page, number, tag, screenshots, touch) {
  assert.equal(await page.locator('#countObjects button').count(), number);
  const choices = await page.locator('[data-count-choice]').evaluateAll(buttons => buttons.map(button => Number(button.dataset.countChoice)));
  assert.equal(new Set(choices).size, 3); assert.ok(choices.includes(number)); assert.ok(choices.every(n => n >= 1 && n <= 10));
  if (number === 1 || number === 10) {
    await page.locator('[data-count-choice="' + choices.find(n => n !== number) + '"]').click();
    assert.equal(await page.locator('#countMatch').isVisible(), true, 'A wrong answer stays on the same question');
    assert.equal(await page.locator('#countObjects button').count(), number);
    assert.match(await page.locator('#countFeedback').textContent(), /再数/);
    const first = page.locator('#countObjects button').first();
    await first.click(); await first.click();
    assert.equal(await page.locator('#countObjects [aria-pressed="true"]').count(), 1, 'An object cannot be counted twice');
    for (let i = 1; i < number; i++) await page.locator('#countObjects button').nth(i).click();
    assert.match(await page.locator('#countTapHint').textContent(), new RegExp('一共有 ' + number));
    const utterances = await page.evaluate(() => window.__countSpeech);
    assert.ok(utterances.some(item => item.text === (number === 1 ? '一' : '十')));
    await inspect(page, tag + '-match-' + number, screenshots);
    await page.locator('#countResetMarks').click();
    assert.equal(await page.locator('#countObjects [aria-pressed="true"]').count(), 0);
  } else await inspect(page, tag + '-match-' + number);
  await page.locator('[data-count-choice="' + number + '"]').click(); await readyToTrace(page);
  assert.match(await page.locator('#countTitle').textContent(), new RegExp('学写 ' + number));
  assert.equal(await page.locator('#writingNext').isDisabled(), true, 'Watching a demonstration alone does not finish practice');
  await inspect(page, tag + '-write-' + number, screenshots);
  if (number === 1) {
    const points = await strokePoints(page, 0);
    await page.mouse.click(points.at(-1).x, points.at(-1).y);
    assert.equal(await page.locator('#writingInk path').count(), 0, 'Touching the end does not complete a stroke');
    await drag(page, [points[0], { x: points[0].x + 70, y: points[0].y }]);
    assert.equal(await page.locator('#writingNext').isDisabled(), true, 'Drawing away from the stroke does not finish it');
    await page.locator('#writingClearButton').click();
    assert.equal(await page.locator('#writingInk path').count(), 0);
  }
  if (number === 2) {
    const points = await strokePoints(page, 0), partial = points.slice(0, Math.ceil(points.length / 3));
    await drag(page, partial);
    const before = await page.locator('#writingInk').innerHTML();
    assert.ok(before.includes('trace-ink'));
    await page.locator('#writingBack').click();
    assert.equal(await page.locator('#countObjects button').count(), 2);
    assert.equal(await page.locator('[data-count-choice="2"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#countContinue').click();
    assert.equal(await page.locator('#writingInk').innerHTML(), before, 'Back and resume preserve tracing');
    await page.locator('#writingDemoButton').click(); await readyToTrace(page);
    assert.equal(await page.locator('#writingInk').innerHTML(), before, 'Replay preserves the child’s partial writing');
    await page.locator('#backHome').click();
    await page.locator('[data-open-mode="count"]').click();
    assert.equal(await page.locator('#writingInk').innerHTML(), before, 'Switching modes preserves writing');
    await page.locator('#writingClearButton').click();
  }
  if (number === 4 || number === 5) {
    const second = await strokePoints(page, 1);
    if (number === 4) {
      await drag(page, second);
      assert.equal(await page.locator('#writingNext').isDisabled(), true, 'Writing the second stroke first cannot finish 4');
      await page.locator('#writingClearButton').click();
    }
  }
  await writeGlyph(page, number === 10 ? '1' : String(number), touch);
  if (number === 10) {
    assert.match(await page.locator('#writingNext').textContent(), /接着写 0/);
    assert.match(await page.locator('#countRange').textContent(), /已学 9\/10/);
    await page.locator('#writingNext').click(); await readyToTrace(page);
    assert.equal(await page.locator('#writingSequence .is-current').textContent(), '0');
    await inspect(page, tag + '-write-10-zero', screenshots);
    await writeGlyph(page, '0', touch);
    assert.match(await page.locator('#countRange').textContent(), /已学 10\/10/);
  }
  await inspect(page, tag + '-complete-' + number, screenshots && [4, 8, 10].includes(number));
  await page.locator('#writingNext').click();
  assert.equal(await page.locator('#countObjects button').count(), number % 10 + 1);
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
  try {
    for (const viewport of viewports) {
      const tag = viewport.width + 'x' + viewport.height;
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width === 360 });
      page.setDefaultTimeout(6000); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.__countSpeech = []; window.__countStop = 0; window.AndroidTts = { speak(text, rate) { window.__countSpeech.push({ text, rate }); }, stop() { window.__countStop++; }, isReady() { return true; } }; });
      await page.goto(url + '#home');
      assert.equal(await page.locator('[data-open-mode]').count(), 6);
      await inspect(page, tag + '-home', true, '#homeScreen button, #homeScreen .mode-cover, .header button');
      await page.locator('[data-open-mode="count"]').click();
      await page.waitForFunction(() => document.body.dataset.mode === 'count');
      assert.equal(await page.locator('#openCountHelp').isVisible(), true);
      await page.locator('#openCountHelp').click();
      assert.equal(await page.locator('#app').getAttribute('inert'), '');
      await page.locator('#closeCountHelp').click();
      assert.equal(await page.locator('#app').getAttribute('inert'), null);
      const touch = viewport.width === 360 ? await page.context().newCDPSession(page) : null;
      for (let number = 1; number <= 10; number++) await learnRound(page, number, tag, viewport.width === 412 && viewport.height === 840, touch);
      assert.deepEqual(errors, []);
      console.log('PASS ' + tag + ': 1–10, retries, counting, stroke order, 10 as 1+0, replay, return, ' + (touch ? 'touch tracing' : 'mouse tracing'));
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 412, height: 840 }, reducedMotion: 'no-preference' });
    await page.goto(url + '#count');
    await page.locator('[data-count-choice="1"]').click();
    await page.waitForFunction(() => {
      const path = document.querySelector('#writingDemoLayer path');
      return path && Number(path.getAttribute('stroke-dashoffset')) < path.getTotalLength() * .7 && document.getElementById('writingDemoLabel').textContent === '自己写';
    });
    await inspect(page, 'animated-demo', true);
    assert.equal(await page.locator('#writingDemoLayer').isVisible(), true, 'The animated ink is actually visible');
    assert.equal(await page.locator('#writingInk').isVisible(), false, 'Manual ink is hidden while the demonstration runs');
    await page.locator('#writingDemoButton').click();
    assert.equal(await page.locator('#writingDemoLabel').textContent(), '看示范');
    assert.equal(await page.locator('#writingDemoLayer').isVisible(), false);
    assert.equal(await page.locator('#writingNext').isDisabled(), true);
    await page.locator('#writingSvg').focus();
    for (let i = 0; i < 30 && await page.locator('#writingNext').isDisabled(); i++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#writingNext').isEnabled(), true, 'Keyboard direction input can finish 1');
    await page.locator('#openCountHelp').click();
    assert.equal(await page.evaluate(() => window.NumberLearningUI.back()), true, 'Android Back first closes the help dialog');
    assert.equal(await page.locator('#writingLesson').isVisible(), true);
    assert.equal(await page.evaluate(() => window.NumberLearningUI.back()), true, 'Android Back then returns from writing to the same count');
    assert.equal(await page.locator('#countObjects button').count(), 1);
    await page.setViewportSize({ width: 740, height: 360 });
    await inspect(page, 'landscape-count', true, targets, true);
    await page.locator('#countContinue').click();
    await inspect(page, 'landscape-write', true, targets, true);
    await page.close();
    console.log('PASS animated stroke demonstration, keyboard input, Android Back bridge and landscape layout');
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
