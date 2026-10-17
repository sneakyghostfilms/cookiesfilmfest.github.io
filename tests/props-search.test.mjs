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

test('keyword queries rank the matching items first', () => {
  assert.equal(keys('change machine')[0], 'scp-056');
  assert.equal(keys('telephone book')[0], 'scp-051');
  assert.equal(keys('secretary handbook')[0], 'scp-024');
  assert.equal(keys('handcuffs')[0], 'scp-142');
  assert.ok(keys('secret').includes('scp-021'), 'prefix match');
  assert.deepEqual(keys('zzqx nonsense'), []);
});

test('AI tags extend keyword search to synonyms the vendor did not print', () => {
  assert.deepEqual(keys('megaphone'), ['scp-284']);
  assert.ok(keys('coin changer').includes('scp-056'));
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
