'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pinyin, customPinyin } = require('../tools/poetry-data/node_modules/pinyin-pro');
const OpenCC = require('../tools/poetry-data/node_modules/opencc-js');
const directory = path.resolve(__dirname, '../content/poetry');
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
// These literary characters have uncommon extension-plane simplified forms;
// retain the widely printed forms so Android fonts can display the poems.
const convert = text => toSimplified(text).replaceAll('䯄', '騧').replaceAll('𡒄', '壈').replaceAll('𪭢', '摐').replaceAll('㧑', '撝').replaceAll('䝙', '貙');
const source = JSON.parse(fs.readFileSync(path.join(directory, 'source/tangshi-300.raw.json'), 'utf8'));
const overrides = JSON.parse(fs.readFileSync(path.join(directory, 'pronunciations.json'), 'utf8'));
const corrections = JSON.parse(fs.readFileSync(path.join(directory, 'corrections.json'), 'utf8'));
const review = JSON.parse(fs.readFileSync(path.join(directory, 'baidu-review.json'), 'utf8'));
customPinyin(overrides);
const han = /\p{Script=Han}/u;
function tokens(text) {
  const result = pinyin(text, { type: 'all', toneSandhi: false }).map(item => [item.origin, item.isZh ? item.pinyin : '']);
  assert.equal(result.map(item => item[0]).join(''), text, 'Pinyin must preserve every source character');
  for (const [character, sound] of result) if (han.test(character)) assert.ok(sound && !han.test(sound), 'Missing pronunciation for ' + character + ': ' + text);
  return result;
}
let order = 0;
function removeVariants(text, variants) {
  let depth = 0, note = '', result = '';
  for (const character of text) {
    if ('（('.includes(character)) { if (depth++) note += character; continue; }
    if ('）)'.includes(character) && depth) { if (--depth) note += character; else { variants.push(note.trim()); note = ''; } continue; }
    if (depth) note += character; else result += character;
  }
  assert.equal(depth, 0, 'An unclosed variant note needs review: ' + text);
  return result.replace(/\s+/g, '').trim();
}
const poems = source.content.flatMap(group => group.content.map(raw => {
  const number = ++order;
  const correction = corrections[number] || {};
  const variants = [];
  // Some source variant notes span several paragraph entries.
  let paragraphs = [removeVariants(convert(correction.text || raw.paragraphs.join('')), variants).replace(/[?!,;:]/g, character => ({'?':'？','!':'！',',':'，',';':'；',':':'：'}[character]))].filter(Boolean);
  for (const [before,after] of Object.entries(correction.replacements || {})) paragraphs = paragraphs.map(text => text.replaceAll(before,after));
  for (const change of review.textCorrections.filter(item => item.number === number)) {
    assert.equal(paragraphs.join('').split(change.before).length-1, 1, 'Text correction must match once: '+number+' '+change.before);
    paragraphs = paragraphs.map(text => text.replace(change.before, change.after));
    variants.push('校订：底本“'+change.before+'”改为“'+change.after+'”。'+change.reason);
  }
  // Correct a punctuation slip in the selected source without changing its wording.
  if (number === 11) paragraphs = paragraphs.map(line => line.replace('疑是地上霜，', '疑是地上霜。'));
  const title = correction.title || convert(raw.chapter);
  const alternateTitle = raw.subchapter && !raw.subchapter.includes('…') ? convert(raw.subchapter) : '';
  const author = convert(raw.author);
  const type = convert(group.type);
  const verses = paragraphs.flatMap(paragraph => paragraph.match(/[^，。？！；：]+[，。？！；：]?/gu) || []);
  assert.ok(verses.length >= 4, 'Poem has fewer than four verses: ' + title);
  const lengths = verses.map(verse => [...verse].filter(character => han.test(character)).length);
  const meter = type.startsWith('五言') ? 'five' : type.startsWith('七言') ? 'seven' : lengths.every(length => length === 5) ? 'five' : lengths.every(length => length === 7) ? 'seven' : 'mixed';
  const genre = type.endsWith('绝句') ? 'jue' : type.endsWith('律诗') ? 'lv' : type.endsWith('古诗') ? 'gu' : 'yuefu';
  const prepared = verses.map(text => ({ text, tokens: tokens(text) }));
  for (const rule of review.pronunciations.filter(item => item.number === number)) {
    const matches=prepared.filter(verse => verse.text.includes(rule.phrase));
    assert.equal(matches.length,1,'Pronunciation phrase must match once: '+number+' '+rule.phrase);
    const verse=matches[0],start=verse.text.indexOf(rule.phrase);let offset=0,applied=new Set();
    for(const token of verse.tokens){
      if(offset>=start&&offset<start+rule.phrase.length&&Object.hasOwn(rule.sounds,token[0])){token[1]=rule.sounds[token[0]];applied.add(token[0]);}
      offset+=token[0].length;
    }
    assert.deepEqual([...applied].sort(),Object.keys(rule.sounds).sort(),'Every reviewed reading must apply');
  }
  return { id: 'ts-' + String(number).padStart(3, '0'), number, title, alternateTitle, author, type, meter, genre, titleTokens: tokens(title), authorTokens: tokens(author), verses: prepared, variants };
}));
assert.equal(poems.length, 320, 'Use the entire selected anthology');
assert.equal(new Set(poems.map(poem => poem.id)).size, 320);
assert.equal(poems.find(poem => poem.number === 228).verses.length, 24, 'The source omitted the final sixteen verses of 赠卫八处士');
fs.writeFileSync(path.join(directory, 'poems.base.json'), JSON.stringify(poems) + '\n', 'utf8');
const catalog = poems.map(poem => `${poem.number}\t${poem.type}\t${poem.title}\t${poem.author}\t${poem.verses.map(verse => verse.text).join('')}`).join('\n');
fs.writeFileSync(path.join(directory, 'catalog.tsv'), catalog + '\n', 'utf8');
const stats = Object.fromEntries(['five', 'seven', 'mixed'].map(meter => [meter, poems.filter(poem => poem.meter === meter).length]));
console.log(JSON.stringify({ poems: poems.length, meters: stats, overrides: Object.keys(overrides).length, reviewedText: review.textCorrections.length, reviewedPhrases: review.pronunciations.length, longest: Math.max(...poems.map(poem => poem.verses.map(verse => verse.text).join('').length)) }, null, 2));
