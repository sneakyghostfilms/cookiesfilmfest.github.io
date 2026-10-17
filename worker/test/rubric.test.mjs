import assert from 'node:assert/strict';
import test from 'node:test';
import { score } from '../scripts/rubric.mjs';

const fixture = {
  id: 'diner',
  required: [
    { prop: 'tie waist apron', acceptableKeys: ['scp-105', 'scp-365'] },
    { prop: 'half apron', acceptableKeys: ['scp-365'] },
    { prop: 'pistol', acceptableKeys: ['scp-261', 'scp-263'] },
  ],
  absent: ['jukebox'],
};
const prop = (name, keys) => ({ prop: name, reason: 'r', keys });

test('every returned key that is not acceptable for its own prop counts as wrong', () => {
  const result = score(fixture, { required: [prop('pistol', ['scp-261', 'scp-119'])], optional: [] });
  assert.equal(result.required.find((entry) => entry.prop === 'pistol').found, true);
  assert.deepEqual(result.wrongKeys, ['pistol: scp-119']);
});

test('a key acceptable for another expected prop is still wrong for this one', () => {
  const result = score(fixture, { required: [prop('pistol', ['scp-263', 'scp-105'])], optional: [] });
  assert.deepEqual(result.wrongKeys, ['pistol: scp-105']);
});

test('a key two expected props share is matched to the prop the name describes', () => {
  const result = score(fixture, { required: [prop('white tie-waist apron', ['scp-105']), prop('half apron', ['scp-365'])], optional: [] });
  assert.deepEqual(result.wrongKeys, []);
  assert.deepEqual(result.required.map((entry) => entry.found), [true, true, false]);
});

test('a prop is judged against the expected prop its name describes, not one its key happens to fit', () => {
  const kitchen = {
    id: 'kitchen',
    required: [{ prop: 'coffee dispenser', acceptableKeys: ['scp-004'] }, { prop: 'coffee pot', acceptableKeys: ['scp-005'] }],
    absent: [],
  };
  const result = score(kitchen, { required: [prop('green coffee dispenser', ['scp-004']), prop('clear coffee pot with gold decals', ['scp-004'])], optional: [] });
  assert.deepEqual(result.wrongKeys, ['clear coffee pot with gold decals: scp-004']);
  assert.deepEqual(result.required.map((entry) => entry.found), [true, false]);
});

test('unexpected matches count as wrong in the required list but are only listed as set dressing', () => {
  const result = score(fixture, { required: [prop('ashtray', ['scp-036'])], optional: [prop('globe decor', ['scp-038']), prop('pistol', ['scp-261', 'scp-999'])] });
  assert.deepEqual(result.wrongKeys, ['ashtray: scp-036', 'pistol: scp-999']);
  assert.deepEqual(result.setDressing, ['globe decor [scp-038]']);
});

test('absent props are reported, force-matched or left out by whole-name match', () => {
  assert.equal(score(fixture, { required: [prop('jukebox', [])], optional: [] }).absent[0].outcome, 'reported as no match');
  assert.equal(score(fixture, { required: [prop('old jukebox', ['scp-140'])], optional: [] }).absent[0].outcome, 'force-matched (scp-140)');
  assert.equal(score(fixture, { required: [prop('juke', [])], optional: [] }).absent[0].outcome, 'left out');
});
