import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIndex, compareByName, parseDecades, search, stem, tokenize } from '../src/scripts/props-search.js';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const inventory = await read('../src/data/props/inventory.json');
const tagsFile = await read('../src/data/props/tags.json');
const docs = inventory.items.map((item, order) => ({
  key: item.key,
  name: item.name,
  description: item.description,
  categories: item.categories,
  tags: tagsFile.tags[item.key] ?? [],
  decades: item.decades,
  order,
}));
const index = buildIndex(docs);
const keys = (query, filters) => search(index, query, filters).map((doc) => doc.key);

test('tokenize lowercases, drops apostrophes and lightly stems', () => {
  assert.deepEqual(tokenize('SECRETARY’S Phones, boxes & dress'), ['secretary', 'phone', 'box', 'dress']);
  assert.equal(stem('glasses'), 'glass');
  assert.equal(stem('batteries'), 'battery');
  assert.equal(stem('gas'), 'gas');
});

test('parseDecades understands the ways people write a decade', () => {
  const decades = (query) => [...parseDecades(query)].sort();
  assert.deepEqual(decades('a phone from the 60s'), [1960]);
  assert.deepEqual(decades("'70s lamp"), [1970]);
  assert.deepEqual(decades('1960s office'), [1960]);
  assert.deepEqual(decades('sixties diner'), [1960]);
  assert.deepEqual(decades('a 1965 car'), [1960]);
  assert.deepEqual(decades('2000s flip phone'), [2000]);
  assert.deepEqual(decades('police jacket size 40'), []);
});

test('with no query the full list comes back alphabetically by name', () => {
  assert.deepEqual(keys(''), [...docs].sort(compareByName).map((doc) => doc.key));
  assert.deepEqual(keys('a the for some'), keys(''));
});

test('alphabetical order ignores opening quotes but keeps digits first', () => {
  const names = ['“JADE” NAME TAG', 'HOSPITAL BLANKET', '24 QT IGLOO COOLER', 'JUDGE’S WOODEN GAVEL', '“GEORGE ADAMS’” NAME TAG'];
  const sorted = names.map((name, index) => ({ name, key: `k${index}` })).sort(compareByName).map((entry) => entry.name);
  assert.deepEqual(sorted, ['24 QT IGLOO COOLER', '“GEORGE ADAMS’” NAME TAG', 'HOSPITAL BLANKET', '“JADE” NAME TAG', 'JUDGE’S WOODEN GAVEL']);
});

const top = (query, count) => keys(query).slice(0, count);

test('keyword queries rank the matching items first', () => {
  assert.deepEqual(top('rotary phone', 5).sort(), ['scp-054-1', 'scp-054-2', 'scp-055', 'scp-134', 'scp-296']);
  assert.deepEqual(top('typewriter', 4).sort(), ['scp-077', 'scp-078', 'scp-079', 'scp-331']);
  assert.equal(keys('change machine')[0], 'scp-056');
  assert.equal(keys('telephone book')[0], 'scp-051');
  assert.equal(keys('secretary handbook')[0], 'scp-024');
  assert.deepEqual(top('handcuffs', 2).sort(), ['scp-142', 'scp-280']);
  assert.deepEqual(keys('santa').sort(), ['scp-210', 'scp-370']);
  assert.deepEqual(keys('wig'), ['scp-082']);
  assert.equal(keys('fake blood')[0], 'scp-057');
  for (const key of ['scp-204', 'scp-236', 'scp-237']) assert.ok(top('police jacket', 3).includes(key), key);
  for (const doc of search(index, 'gun').slice(0, 10)) assert.match(doc.name, /GUN/);
  assert.deepEqual(top('cell phone', 2).sort(), ['scp-122', 'scp-135']);
  assert.ok(keys('secret').includes('scp-021'), 'prefix match');
  assert.deepEqual(keys('zzqx nonsense'), []);
});

test('AI tags extend keyword search to synonyms the vendor did not print', () => {
  assert.deepEqual(keys('megaphone').sort(), ['scp-284', 'scp-372']);
  assert.equal(keys('coin changer')[0], 'scp-056');
});

test('decades boost dated items and decade-only queries return that decade', () => {
  const sixties = keys('60s');
  assert.ok(sixties.length > 0);
  for (const key of sixties) assert.ok(docs.find((doc) => doc.key === key).decades.includes(1960), key);
  assert.equal(keys('telephone book from the 60s')[0], 'scp-051');
});

test('filters narrow by section and stated decade', () => {
  const misc = keys('', { category: 'MISCELLANEOUS' });
  assert.deepEqual(misc, docs.filter((doc) => doc.categories.includes('MISCELLANEOUS')).sort(compareByName).map((doc) => doc.key));
  assert.ok(keys('', { decade: '1960' }).every((key) => docs.find((doc) => doc.key === key).decades.includes(1960)));
  assert.deepEqual(keys('jacket', { category: 'THE OFFICE' }), []);
});

test('a bare year finds its decade unless the year itself is printed', () => {
  const year = keys('1965');
  assert.ok(year.length > 0);
  assert.deepEqual(year, keys('60s'));
  assert.deepEqual(top('1991', 3).sort(), ['scp-286-2', 'scp-342', 'scp-351']);
  const printed = buildIndex([
    { key: 'calendar', name: 'PIN-UP CALENDAR 1991', description: 'PIN-UP CALENDAR 1991', categories: [], tags: [], decades: [], order: 0 },
    { key: 'phone', name: 'CORDLESS PHONE', description: 'CORDLESS PHONE 1990S', categories: [], tags: [], decades: [1990], order: 1 },
  ]);
  assert.deepEqual(search(printed, '1991').map((doc) => doc.key), ['calendar', 'phone']);
});

test('items matching every query word outrank stronger single-word matches', () => {
  const filler = Array.from({ length: 6 }, (_, order) => ({ key: `police-${order}`, name: `POLICE ITEM ${order}`, description: `POLICE ITEM ${order}`, categories: [], tags: [], decades: [], order: order + 2 }));
  const local = buildIndex([
    { key: 'nurse', name: 'NURSE SMOCK JACKETS', description: 'NURSE SMOCK JACKETS', categories: [], tags: [], decades: [], order: 0 },
    { key: 'uniform', name: 'BLUE UNIFORM', description: 'BLUE UNIFORM POLICE JACKET', categories: [], tags: [], decades: [], order: 1 },
    ...filler,
  ]);
  assert.deepEqual(search(local, 'police jacket').slice(0, 2).map((doc) => doc.key), ['uniform', 'nurse']);
});
