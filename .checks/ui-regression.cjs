'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseline = process.argv.includes('--baseline');
const output = path.join(__dirname, baseline ? 'before' : 'all-goods');
fs.mkdirSync(output, { recursive: true });
const gameUrl = pathToFileURL(path.join(__dirname, '../app/src/main/assets/index.html')).href;
const executablePath = process.env.PICTURE_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(file => fs.existsSync(file));
const viewports = baseline ? [{ width: 412, height: 840 }, { width: 360, height: 640 }] : [
  { width: 320, height: 568 }, { width: 360, height: 640 },
  { width: 412, height: 840 }, { width: 412, height: 915 },
  { width: 760, height: 900 }, { width: 1280, height: 900 }
];
const report = [];

async function inspect(page, selector, tag, screenshot = false) {
  const issues = await page.locator(selector).evaluateAll(elements => {
    const failures = [];
    const describe = el => el.id || el.getAttribute('aria-label') || el.className.baseVal || el.className;
    for (const el of elements) {
      const box = el.getBoundingClientRect();
      if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      if (box.width < 1 || box.height < 1) { failures.push(describe(el) + ': empty'); continue; }
      if (innerWidth <= 760 && (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1)) {
        failures.push(describe(el) + ': outside viewport');
      }
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        const clippedX = /(hidden|clip|auto|scroll)/.test(style.overflowX) && (box.left < clip.left - 1 || box.right > clip.right + 1);
        const clippedY = /(hidden|clip|auto|scroll)/.test(style.overflowY) && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1);
        if (clippedX || clippedY) { failures.push(describe(el) + ': clipped by ' + describe(parent)); break; }
      }
      if (el.matches('button') && !el.disabled && box.top >= 0 && box.bottom <= innerHeight) {
        for (const [x, y] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.8]]) {
          const hit = document.elementFromPoint(box.left + box.width * x, box.top + box.height * y);
          if (hit && !el.contains(hit)) { failures.push(describe(el) + ': covered by ' + describe(hit)); break; }
        }
      }
    }
    return [...new Set(failures)];
  });
  if (screenshot) await page.screenshot({ path: path.join(output, tag + '.png'), fullPage: true });
  report.push({ tag, issues });
  if (issues.length) console.log(tag + ': ' + JSON.stringify(issues));
  if (!baseline) assert.deepEqual(issues, [], tag);
}

const sortTargets = '#classificationScreen button, #classificationScreen select, #goodsTray .goods-label, #goodsTray .art, #shelfGrid .shelf-name, #shelfGrid .shelf-icon, #shelfGrid .shelf-icon > .art, #shelfGrid .shelf-slot-label, #shelfGrid .shelf-slot > .art, #oddGoods .goods-label, #oddGoods .art, #sortAnswerGuide .answer-group-name, #sortAnswerGuide .art';
async function visibleTray(page) {
  return page.locator('#goodsTray button').evaluateAll(elements => elements.filter(el => el.getClientRects().length && !el.disabled).map(el => ({ id: el.dataset.goodsId })));
}
async function checkTray(page, remaining, compact) {
  const visible = await visibleTray(page);
  assert.equal(visible.length, remaining, 'Every remaining item is immediately selectable');
  assert.equal(new Set(visible.map(item => item.id)).size, visible.length, 'No duplicate cards');
  const shown = await page.locator('#goodsTray button').evaluateAll(elements => elements.filter(el => el.getClientRects().length).length);
  assert.equal(shown, 9, 'All nine goods stay visible, including marked items after placement');
  assert.equal(await page.locator('#goodsTray button.is-placed:disabled').count(), 9 - remaining);
  if (compact) {
    const fonts = await page.locator('#goodsTray .goods-label').evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => parseFloat(getComputedStyle(el).fontSize)));
    assert.ok(fonts.every(size => size >= 12), 'Phone item names stay larger than the previous nine-item layout');
  }
  return visible;
}
async function checkAnswerGroups(page, ids, standard) {
  const groups = await page.locator('#sortAnswerGuide [data-read-group]').evaluateAll(elements => elements.map(el => ({ group: el.dataset.readGroup, ids: [...el.querySelectorAll('[data-answer-id]')].map(item => item.dataset.answerId) })));
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.flatMap(group => group.ids).sort(), [...ids].sort(), 'The answer shows all nine item pictures exactly once');
  for (const group of groups) {
    assert.equal(group.ids.length, 3);
    const categories = await page.evaluate(({ ids, standard }) => ids.map(id => window.Classification.byId[id][standard]), { ids: group.ids, standard });
    assert.ok(categories.every(category => category === group.group), 'Every answer picture belongs to the displayed category');
  }
}
async function cipherState(page) {
  return page.evaluate(() => ({
    question: [...document.querySelectorAll('#codeList .code')].map(el => el.getAttribute('aria-label').replace('，已找到', '')),
    round: document.getElementById('roundNumber').textContent,
    layout: [...document.querySelectorAll('#matrix .card')].map(el => el.dataset.card),
    matched: [...document.querySelectorAll('#matrix .matched')].map(el => el.dataset.card),
    progress: document.getElementById('progressText').textContent
  }));
}

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const size = viewport.width + 'x' + viewport.height;
      await page.goto(gameUrl + '#home');
      if (!baseline) {
        await inspect(page, '#homeScreen button, .header button', size + '-home');
        await page.locator('[data-open-mode="cipher"]').click();
        await page.waitForFunction(() => document.body.dataset.mode === 'cipher');
        const original = await cipherState(page);
        assert.equal(await page.locator('#boardNextQuestion use').getAttribute('href'), '#i-refresh');
        await page.locator('#hintButton').click();
        for (let slot = 0; slot < 3; slot++) {
          const id = await page.evaluate(index => {
            const code = document.querySelectorAll('#codeList .code')[index];
            const column = code.querySelector('.code-number').textContent;
            const row = window.PictureCipher.rows.findIndex(item => code.querySelector('.code-caption').textContent.includes(item.name + '色行'));
            return document.querySelector('#matrix .card[data-column="' + column + '"][data-row="' + row + '"]').dataset.card;
          }, slot);
          await page.locator('#matrix [data-card="' + id + '"]').click();
        }
        await page.locator('#winConfirm').click();
        await inspect(page, '#cipherAnswerView button, #cipherAnswerView .label', size + '-cipher-answer', viewport.width === 412 && viewport.height === 840);
        const completed = await cipherState(page);
        const sentence = await page.locator('#answerViewSentence').textContent();
        await page.locator('#answerViewBack').click();
        assert.deepEqual(await cipherState(page), completed, 'Return preserves the question, grid and selected cards');
        await inspect(page, '#codeList button, #matrix button, #hintButton, #boardNextQuestion', size + '-cipher-return', viewport.width === 412 && viewport.height === 840);
        await page.locator('#matrix .matched').first().click();
        assert.equal(await page.locator('#cipherAnswerView').isVisible(), true, 'Selected card can reopen the answer');
        assert.equal(await page.locator('#answerViewSentence').textContent(), sentence);
        await page.locator('#answerViewBack').click();
        await page.locator('#boardNextQuestion').click();
        const next = await cipherState(page);
        assert.notDeepEqual(next.question, original.question, 'Refresh changes the question');
        assert.deepEqual(next.layout, original.layout, 'Refresh keeps the board layout');
        assert.equal(next.matched.length, 0);
        assert.equal(await page.locator('#hintButton').isEnabled(), true);
        await page.locator('#backHome').click();
      }
      await page.goto(gameUrl + '#sort');
      if (!baseline) await page.evaluate(() => {
        window.__sortSpeech = [];
        window.AndroidTts = { speak(text, rate) { window.__sortSpeech.push({ text, rate }); }, stop() {}, isReady() { return true; } };
      });
      for (const standard of ['purpose', 'material']) {
        await page.locator('[data-sort-standard="' + standard + '"]').click();
        await inspect(page, sortTargets, size + '-' + standard + '-empty', true);
        if (baseline) {
          const id = await page.locator('#goodsTray button').first().getAttribute('data-goods-id');
          const group = await page.evaluate(({ id, standard }) => window.Classification.byId[id][standard], { id, standard });
          await page.locator('[data-goods-id="' + id + '"]').click();
          await page.locator('[data-bin="' + group + '"]').click();
          await inspect(page, sortTargets, size + '-' + standard + '-placed', true);
          continue;
        }
        const ids = await page.locator('#goodsTray button').evaluateAll(elements => elements.map(el => el.dataset.goodsId));
        const compact = viewport.width <= 760;
        assert.equal(ids.length, 9, 'A round still contains nine items');
        await checkTray(page, 9, compact);
        const order = [...ids].reverse();
        for (let index = 0; index < order.length; index++) {
          const id = order[index];
          const before = await visibleTray(page);
          const group = await page.evaluate(({ id, standard }) => window.Classification.byId[id][standard], { id, standard });
          await page.locator('[data-goods-id="' + id + '"]').click();
          if (index === 0) {
            const wrong = await page.locator('[data-bin]:not([data-bin="' + group + '"])').first().getAttribute('data-bin');
            await page.locator('[data-bin="' + wrong + '"]').click();
            assert.match(await page.locator('#sortProgress').textContent(), /0 \/ 9/);
            assert.deepEqual(await visibleTray(page), before, 'A wrong shelf does not consume or hide any goods');
            await page.locator('#sortToggleAnswer').click();
            await checkAnswerGroups(page, ids, standard);
            await inspect(page, sortTargets, size + '-' + standard + '-peek');
            await page.locator('#sortToggleAnswer').click();
            assert.deepEqual(await visibleTray(page), before, 'Returning from the answer preserves every available item');
            assert.equal(await page.locator('[data-goods-id="' + id + '"]').getAttribute('aria-pressed'), 'true', 'The selected item stays selected after returning');
          }
          await page.locator('[data-bin="' + group + '"]').click();
          assert.match(await page.locator('#sortProgress').textContent(), new RegExp((index + 1) + ' / 9'));
          if (index < ids.length - 1) {
            const after = await checkTray(page, 8 - index, compact);
            assert.deepEqual(after, before.filter(item => item.id !== id), 'Unplaced cards keep their order');
            const placedNames = await page.locator('#shelfGrid .shelf-slot-label').allTextContents();
            const expectedNames = await page.evaluate(ids => ids.map(id => window.Classification.byId[id].name), order.slice(0,index+1));
            assert.deepEqual(placedNames.sort(), expectedNames.sort(), 'Placed goods appear in the shelf slots');
            await inspect(page, sortTargets, size + '-' + standard + '-placed-' + (index + 1));
          }
        }
        await checkAnswerGroups(page, ids, standard);
        await inspect(page, sortTargets, size + '-' + standard + '-answer', true);
        await page.locator('#speakSortReason').click();
        const fullSpeech = await page.evaluate(() => window.__sortSpeech.at(-1));
        assert.match(fullSpeech.text, /分类标准/, 'The concise answer still reads the full explanation aloud');
        assert.equal(fullSpeech.rate, 0.92);
        await inspect(page, sortTargets + ', #sortSpeechStatus', size + '-' + standard + '-speaking');
        await page.locator('#sortStopSpeech').click();
        await page.locator('#sortSlowSpeech').check();
        const answerGroup = page.locator('#sortAnswerGuide [data-read-group]').first();
        const groupNames = await answerGroup.locator('.answer-group-name').allTextContents();
        await answerGroup.click();
        const groupSpeech = await page.evaluate(() => window.__sortSpeech.at(-1));
        assert.ok(groupNames.every(name => groupSpeech.text.includes(name)), 'Tapping a group reads all three displayed items');
        assert.equal(groupSpeech.rate, 0.72);
        await inspect(page, sortTargets + ', #sortSpeechStatus', size + '-' + standard + '-slow-speaking');
        await page.locator('#sortStopSpeech').click();
        await page.locator('#sortSlowSpeech').uncheck();
        await page.locator('#sortToggleAnswer').click();
        assert.match(await page.locator('#sortProgress').textContent(), /9 \/ 9/);
        await checkTray(page, 0, compact);
        assert.equal(await page.locator('#shelfGrid .shelf-slot-label').count(), 9, 'The completed shelves show all nine item names');
        await inspect(page, sortTargets, size + '-' + standard + '-returned', true);
        await page.locator('#sortNext').click();
        await checkTray(page, 9, compact);
        assert.match(await page.locator('#sortProgress').textContent(), /0 \/ 9/);
      }
      if (!baseline) {
        if (viewport.width > 760) {
          const id = await page.locator('#goodsTray button').last().getAttribute('data-goods-id');
          const group = await page.evaluate(id => window.Classification.byId[id].material, id);
          await page.locator('[data-goods-id="' + id + '"]').click();
          await page.locator('[data-bin="' + group + '"]').click();
          await page.locator('#undoSort').click();
          assert.match(await page.locator('#sortProgress').textContent(), /0 \/ 9/);
          await page.setViewportSize({ width: 412, height: 840 });
          await checkTray(page, 9, true);
          assert.equal(await page.locator('[data-goods-id="' + id + '"]').isVisible(), true, 'An undone desktop selection stays visible after switching to a phone width');
          assert.equal(await page.locator('[data-goods-id="' + id + '"]').getAttribute('aria-pressed'), 'true');
          await inspect(page, sortTargets, size + '-resized-with-selection');
          await page.setViewportSize(viewport);
        }
        await page.locator('[data-sort-play="odd"]').click();
        for (const standard of ['purpose', 'material']) {
          await page.locator('[data-sort-standard="' + standard + '"]').click();
          for (const count of ['3', '5']) {
            await page.locator('#oddSize').selectOption(count);
            await inspect(page, sortTargets, size + '-odd-' + standard + '-' + count, true);
            const answer = await page.evaluate(standard => {
              const ids = [...document.querySelectorAll('#oddGoods button')].map(el => el.dataset.oddId);
              const counts = {};
              ids.forEach(id => { const group = window.Classification.byId[id][standard]; counts[group] = (counts[group] || 0) + 1; });
              return ids.find(id => counts[window.Classification.byId[id][standard]] === 1);
            }, standard);
            await page.locator('[data-odd-id="' + answer + '"]').click();
            await inspect(page, sortTargets, size + '-odd-answer-' + standard + '-' + count);
            await page.locator('#sortToggleAnswer').click();
            assert.equal(await page.locator('#oddGoods .odd-correct').count(), 1);
          }
        }
        await page.locator('#openSortHelp').click();
        await page.locator('#closeSortHelp').click();
        await page.locator('#sortNext').click();
      }
      assert.deepEqual(errors, [], 'No browser script errors');
      console.log('PASS ' + size + (baseline ? ' baseline captured' : ' complete game flows and visible click targets'));
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
