'use strict';
const path = require('node:path');
const sharp = require('sharp');
const folder = path.join(__dirname, 'number-game');
const entries = Array.from({ length: 10 }, (_, i) => ({ label: i === 9 ? '10 · 1' : String(i + 1), file: '412x840-write-' + (i + 1) + '.png' }));
entries.push({ label: '10 · 0', file: '412x840-write-10-zero.png' });
(async () => {
  const layers = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i], left = i % 4 * 210, top = Math.floor(i / 4) * 295;
    const picture = await sharp(path.join(folder, entry.file)).extract({ left: 20, top: 245, width: 372, height: 465 }).resize(190, 238).png().toBuffer();
    const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="210" height="42"><text x="105" y="30" text-anchor="middle" font-family="Arial,sans-serif" font-size="23" fill="#263e36">' + entry.label + '</text></svg>');
    layers.push({ input: label, left, top }, { input: picture, left: left + 10, top: top + 44 });
  }
  await sharp({ create: { width: 840, height: 885, channels: 4, background: '#f7f8f2' } }).composite(layers).png().toFile(path.join(folder, 'digit-overview.png'));
  console.log('Digit teaching overview saved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
