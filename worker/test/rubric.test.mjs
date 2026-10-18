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

test('a prop the fixture does not name is an extra in the required list and set dressing in the optional list, never wrong', () => {
  const result = score(fixture, { required: [prop('ashtray', ['scp-036'])], optional: [prop('globe decor', ['scp-038']), prop('pistol', ['scp-261', 'scp-999'])] });
  assert.deepEqual(result.wrongKeys, ['pistol: scp-999']);
  assert.deepEqual(result.extras, [{ prop: 'ashtray', keys: ['scp-036'] }]);
  assert.deepEqual(result.setDressing, ['globe decor [scp-038]']);
});

test('a suggestion that only shares a word with a required prop is not judged against it', () => {
  const morgue = { id: 'morgue', required: [{ prop: 'red chair', acceptableKeys: ['k-red-chair'] }], absent: [] };
  const optional = score(morgue, { required: [], optional: [prop('side chairs', ['k-side-chairs'])] });
  assert.deepEqual([optional.wrongKeys, optional.setDressing], [[], ['side chairs [k-side-chairs]']]);
  const extra = score(morgue, { required: [prop('desk', ['k-desk'])], optional: [] });
  assert.deepEqual([extra.wrongKeys, extra.extras], [[], [{ prop: 'desk', keys: ['k-desk'] }]]);
});

test('a suggestion under another name is judged by the acceptable keys it returned', () => {
  const morgue = { id: 'morgue', required: [{ prop: 'fridge', acceptableKeys: ['k-fridge'] }], absent: [] };
  const result = score(morgue, { required: [], optional: [prop('old refrigerator', ['k-fridge', 'k-freezer'])] });
  assert.deepEqual(result.required.map((entry) => entry.found), [true]);
  assert.deepEqual(result.wrongKeys, ['old refrigerator: k-freezer']);
});

test('every key returned for a prop the fixture names as absent is wrong, on either list', () => {
  const office = { id: 'office', required: [{ prop: 'change machine', acceptableKeys: ['k-change'] }], absent: ['water cooler', 'fax machine'] };
  const morgue = { id: 'morgue', required: [{ prop: 'bench', acceptableKeys: ['k-bench'] }], absent: ['bone saw', 'specimen jar'] };
  const cases = [
    [office, { required: [prop('fax machine', ['k-copier'])], optional: [] }, ['fax machine: k-copier'], 'fax machine'],
    [office, { required: [], optional: [prop('fax machine', ['k-copier'])] }, ['fax machine: k-copier'], 'fax machine'],
    [office, { required: [prop('fax machine', ['k-change'])], optional: [] }, ['fax machine: k-change'], 'fax machine'],
    [office, { required: [prop('water cooler', ['k-cooler'])], optional: [] }, ['water cooler: k-cooler'], 'water cooler'],
    [morgue, { required: [prop('bone saw', ['k-saw'])], optional: [] }, ['bone saw: k-saw'], 'bone saw'],
    [morgue, { required: [prop('specimen jar on the bench', ['k-bench'])], optional: [] }, ['specimen jar on the bench: k-bench'], 'specimen jar'],
  ];
  for (const [scene, body, wrong, absentName] of cases) {
    const result = score(scene, body);
    const label = `${body.required[0]?.prop ?? body.optional[0].prop} ${JSON.stringify(body.required.length ? 'R' : 'O')}`;
    assert.deepEqual(result.wrongKeys, wrong, label);
    assert.deepEqual(result.extras, [], label);
    assert.match(result.absent.find((entry) => entry.name === absentName).outcome, /^force-matched/, label);
  }
});

test('among props named in full with names equally long, a required prop beats an absent one, then the one more keys fit', () => {
  const office = { id: 'office', required: [{ prop: 'change machine', acceptableKeys: ['k-change'] }], absent: ['fax machine'] };
  const both = score(office, { required: [prop('fax change machine', ['k-change'])], optional: [] });
  assert.deepEqual([both.wrongKeys, both.required.map((entry) => entry.found)], [[], [true]]);
  const kitchen = { id: 'kitchen', required: [{ prop: 'coffee pot', acceptableKeys: ['k-coffee'] }, { prop: 'tea pot', acceptableKeys: ['k-tea'] }], absent: [] };
  const pots = score(kitchen, { required: [prop('tea pot and coffee pot', ['k-tea'])], optional: [] });
  assert.deepEqual([pots.wrongKeys, pots.required.map((entry) => entry.found)], [[], [false, true]]);
});

test('absent props are reported, force-matched or left out by whole-name match', () => {
  assert.equal(score(fixture, { required: [prop('jukebox', [])], optional: [] }).absent[0].outcome, 'reported as no match');
  assert.equal(score(fixture, { required: [prop('old jukebox', ['scp-140'])], optional: [] }).absent[0].outcome, 'force-matched (scp-140)');
  assert.equal(score(fixture, { required: [prop('juke', [])], optional: [] }).absent[0].outcome, 'left out');
});
