import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import inventory from '../../src/data/props/inventory.json' with { type: 'json' };
import kinds from '../../src/data/props/kinds.json' with { type: 'json' };
import tagsFile from '../../src/data/props/tags.json' with { type: 'json' };
import { buildIndex } from '../../src/scripts/props-search.js';
import { prepareScene, searchDocs } from '../src/inventory.js';
import { exposure, lexicalList, resolveLongScene } from '../scripts/compare-retrievers.mjs';

const directory = new URL('./fixtures/scenes/', import.meta.url);
const fixtures = await Promise.all((await readdir(directory)).filter((file) => file.endsWith('.json')).sort()
  .map(async (file) => JSON.parse(await readFile(new URL(file, directory), 'utf8'))));
const longFixture = JSON.parse(await readFile(new URL('./fixtures/long-scene.json', import.meta.url), 'utf8'));
const position = new Map(inventory.items.map((item, at) => [item.key, at]));
const catalogOrder = (keys) => [...keys].sort((a, b) => position.get(a) - position.get(b));

test("the comparison's list with tags is the Worker's own, for every fixture and the long scene", () => {
  const index = buildIndex(searchDocs(inventory.items, tagsFile.tags, kinds));
  for (const scene of [...fixtures, longFixture]) {
    assert.deepEqual(catalogOrder(lexicalList(index, scene.text)), catalogOrder(prepareScene(scene.text).shortlistKeys), scene.id);
  }
});

test('the long scene keeps its original 4,000-character text, and each of its props is one current fixture prop', () => {
  assert.equal(longFixture.text.length, 4000);
  assert.equal(createHash('sha256').update(longFixture.text).digest('hex'), '65d8d8c5afc9d23204db994c25baa81fe89428e2e3ad68b33c9471c8b766f056');
  const long = resolveLongScene(longFixture, fixtures);
  assert.equal(long.required.length, longFixture.required.length);
  for (const prop of long.required) assert.ok(prop.acceptableKeys.length, prop.prop);
  assert.deepEqual(long.absent, ['ketchup bottle', 'jukebox', 'milkshake machine', 'bone saw']);
  assert.throws(() => resolveLongScene({ ...longFixture, required: ['diner:jukebox'] }, fixtures), /matches 0 fixture props/);
});

test('the long scene names every prop of the fixtures whose whole text it holds', () => {
  const whole = fixtures.filter((entry) => longFixture.text.includes(entry.text));
  assert.deepEqual(whole.map((entry) => entry.id), ['diner', 'morgue', 'office'], 'a fixture text changed: decide what the long scene holds');
  for (const fixture of whole) {
    for (const prop of fixture.required) assert.ok(longFixture.required.includes(`${fixture.id}:${prop.prop}`), `${fixture.id}:${prop.prop}`);
    for (const prop of fixture.absent) assert.ok(longFixture.absent.includes(`${fixture.id}:${prop}`), `${fixture.id}:${prop}`);
  }
});

test("exposure counts listed items holding an absent prop's last word", () => {
  const words = { a: new Set(['iv', 'bag']), b: new Set(['stanchion', 'pole']), c: new Set(['monitor']) };
  assert.deepEqual(exposure(['a', 'b', 'c'], ['IV pole', 'heart monitor'], (key) => words[key]).map((entry) => entry.keys), [['b'], ['c']]);
});
