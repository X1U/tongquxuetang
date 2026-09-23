'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(__dirname, '../content/poetry/source');
async function get(url, json = true) {
  const response = await fetch(url, { headers: { 'User-Agent': 'PictureLearning-Poetry' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error('Source returned HTTP ' + response.status + ': ' + url);
  return json ? response.json() : response.text();
}
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const candidates = ['蒙学/tangshisanbaishou.json', '全唐诗/唐诗三百首.json', '唐诗三百首/唐诗三百首.json'];
  const sources = [];
  for (const candidate of candidates) {
    const url = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/' + candidate.split('/').map(encodeURIComponent).join('/');
    let content;
    try { content = await get(url, false); } catch (error) { if (error.message.includes('HTTP 404')) continue; throw error; }
    const data = JSON.parse(content);
    const name = 'tangshi-300.raw.json';
    await fs.writeFile(path.join(directory, name), content, 'utf8');
    sources.push({ path: candidate, localFile: name, url, sha256: crypto.createHash('sha256').update(content).digest('hex') });
    console.log(JSON.stringify({ source: candidate, records: Array.isArray(data) ? data.length : Object.keys(data), sample: Array.isArray(data) ? data[0] : null }, null, 2));
    break;
  }
  if (!sources.length) throw new Error('A complete anthology source was not located');
  const licenseUrl = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/LICENSE';
  await fs.writeFile(path.join(directory, 'LICENSE.chinese-poetry.txt'), await get(licenseUrl, false), 'utf8');
  await fs.writeFile(path.join(directory, 'source.json'), JSON.stringify({ repository: 'https://github.com/chinese-poetry/chinese-poetry', retrievedAt: new Date().toISOString(), sources, licenseUrl }, null, 2) + '\n', 'utf8');
  console.log('Saved anthology source and license under content/poetry/source.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
