import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { diversify, inventoryKeys, prepareScene, shortlist } from '../src/inventory.js';
import { LIMITS } from '../src/scene.js';
import { SCENE, answer, fakeAI, fixedClock, makeEnv, sceneRequest } from './helpers.mjs';

const directory = new URL('./fixtures/scenes/', import.meta.url);
const fixtures = await Promise.all((await readdir(directory)).filter((file) => file.endsWith('.json')).sort()
  .map(async (file) => JSON.parse(await readFile(new URL(file, directory), 'utf8'))));
const office = fixtures.find((fixture) => fixture.id === 'office').text;
const UNREACHABLE = { diner: ['bills'], morgue: ['bench'] };

test('at the shortlist size, each fixture keeps exactly the required props it is pinned to', () => {
  assert.equal(LIMITS.shortlistSize, 100);
  assert.equal(LIMITS.termQuota, 1);
  for (const fixture of fixtures) {
    const keys = new Set(shortlist(fixture.text).map((item) => item.key));
    assert.ok(keys.size <= LIMITS.shortlistSize, fixture.id);
    const missing = fixture.required.filter((prop) => !prop.acceptableKeys.some((key) => keys.has(key))).map((prop) => prop.prop);
    assert.deepEqual(missing, UNREACHABLE[fixture.id] ?? [], fixture.id);
  }
});

test('a period with decades drops items whose stated era contradicts it and keeps undated items', () => {
  const all = shortlist(office);
  const nineties = shortlist(office, '1990s');
  assert.ok(all.some((item) => item.decades.length && !item.decades.includes(1990)), 'the office shortlist holds other decades');
  assert.ok(nineties.some((item) => !item.decades.length), 'undated items stay');
  for (const item of nineties) assert.ok(!item.decades.length || item.decades.includes(1990), item.key);
  assert.deepEqual(shortlist(office, 'WWII'), all, 'a period without decades constrains nothing');
  assert.deepEqual(shortlist(office, ''), all);
});

test('the request path applies the period: contradicting items are neither listed nor accepted back', async () => {
  const { request, shortlistKeys } = prepareScene(office, '1990s');
  const contradicting = shortlist(office).find((item) => item.decades.length && !item.decades.includes(1990));
  assert.ok(contradicting, 'the office scene lists a dated item outside the 1990s without a period');
  assert.ok(!shortlistKeys.has(contradicting.key));
  assert.ok(!request.messages[0].content.includes(`\n${contradicting.key} | `));
  const fitting = [...shortlistKeys][0];
  const env = makeEnv({ AI: fakeAI(() => answer({ required: [{ prop: 'thing', reason: 'r', keys: [contradicting.key, fitting] }], optional: [] })) });
  const response = await handleRequest(sceneRequest(undefined, { body: JSON.stringify({ text: office, period: '1990s' }) }), env, fixedClock());
  const body = await response.json();
  assert.deepEqual(body.required[0].keys, [fitting]);
  assert.equal(body.ignoredSuggestions, 1);
  assert.ok(!env.AI.calls[0].input.messages[0].content.includes(`\n${contradicting.key} | `));
});

test('the same scene always builds the same request', () => {
  for (const fixture of fixtures) {
    assert.equal(JSON.stringify(prepareScene(fixture.text).request), JSON.stringify(prepareScene(fixture.text).request), fixture.id);
  }
});

test('the prompt lists each shortlisted key once, in catalog order, and no other key', () => {
  const { request, shortlistKeys } = prepareScene(office);
  const system = request.messages[0].content;
  for (const key of inventoryKeys) assert.equal(system.split(`\n${key} | `).length - 1, shortlistKeys.has(key) ? 1 : 0, key);
  const position = new Map([...inventoryKeys].map((key, index) => [key, index]));
  const blocks = system.split('\n## ').slice(1).map((block) => [...block.matchAll(/^(\S+) \| /gm)].map(([, key]) => position.get(key)));
  for (const block of blocks) assert.deepEqual(block, [...block].sort((a, b) => a - b), 'items keep catalog order within a section');
  const sections = [...system.matchAll(/^## (.+)$/gm)].map(([, section]) => section);
  assert.equal(new Set(sections).size, sections.length, 'each section appears once');
});

test('keys outside the shortlist are dropped and counted like invented ones', async () => {
  const { shortlistKeys } = prepareScene(SCENE);
  const inside = [...shortlistKeys][0];
  const outside = [...inventoryKeys].find((key) => !shortlistKeys.has(key));
  const env = makeEnv({ AI: fakeAI(() => answer({ required: [{ prop: 'thing', reason: 'r', keys: [outside, inside, 'scp-999'] }], optional: [] })) });
  const body = await (await handleRequest(sceneRequest(), env, fixedClock())).json();
  assert.deepEqual(body.required[0].keys, [inside]);
  assert.equal(body.ignoredSuggestions, 2);
});

test('a scene that matches nothing still reaches the model, with no items listed', () => {
  const { request, shortlistKeys } = prepareScene('qqqq zzzz xxxx vvvv wwww jjjj kkkk');
  assert.equal(shortlistKeys.size, 0);
  assert.match(request.messages[0].content, /grouped by catalog section:\n\n/);
});

const docsOf = (...keys) => keys.map((key) => ({ key }));
const pick = (order, terms, size, quota = 1) => diversify(docsOf(...order), terms.map(([term, keys]) => ({ term, keys })), { size, quota }).map((doc) => doc.key);

test('with no quota the list is the plain top of the ranking', () => {
  assert.deepEqual(pick(['a', 'b', 'c', 'd', 'e'], [['rare', ['e']]], 3, 0), ['a', 'b', 'c']);
});

test("each scene word keeps its best-ranked item, however low it ranks, and the rest fills by rank, in ranking order", () => {
  assert.deepEqual(pick(['a', 'b', 'c', 'd', 'e'], [['common', ['d', 'a', 'b', 'c']], ['rare', ['e']]], 3), ['a', 'b', 'e']);
});

test('words with fewer matches go first when the list runs out, ties in scene order', () => {
  assert.deepEqual(pick(['a', 'b', 'c', 'd', 'e'], [['common', ['a', 'b']], ['rare', ['e']]], 1), ['e']);
  assert.deepEqual(pick(['a', 'b', 'c', 'd'], [['first', ['c']], ['second', ['d']]], 1), ['c']);
});

test('a word pair keeps the best item matching both words, which neither word alone would reach', () => {
  const terms = [['red', ['a', 'c']], ['chair', ['b', 'c']]];
  assert.deepEqual(pick(['a', 'b', 'x', 'c'], terms, 2), ['a', 'b']);
  assert.deepEqual(pick(['a', 'b', 'x', 'c'], [...terms, ['red chair', ['c']]], 2), ['a', 'c']);
});

test('items outside the ranking, such as those a period leaves out, are never picked, and the size is a hard cap', () => {
  assert.deepEqual(pick(['a', 'b'], [['word', ['z', 'b']]], 1), ['b']);
  assert.deepEqual(pick(['a', 'b', 'c', 'd'], [['w1', ['d']], ['w2', ['c']], ['w3', ['b']]], 2, 3).length, 2);
});
