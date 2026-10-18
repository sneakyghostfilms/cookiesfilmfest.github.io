import { LIMITS } from '../src/scene.js';

export const SLOTS = LIMITS.maxRequiredProps + LIMITS.maxOptionalProps;

const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/)
  .filter((word) => word.length > 1)
  .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word));

const sharedWords = (a, b) => {
  const other = new Set(words(b));
  return words(a).filter((word) => other.has(word)).length;
};

const namesAll = (prop, absentName) => {
  const propWords = new Set(words(prop));
  return words(absentName).every((word) => propWords.has(word));
};

// How a suggestion with keys is scored:
// - It names an absent prop in full: a force-match, and every key is wrong.
// - It names one required prop in full: keys acceptable for it are right, and every other key is wrong.
// - It names two or more required props in full (a merge): keys acceptable for any of them are right, a key acceptable
//   only for another required prop of the scene is misfiled, and any other key is wrong.
// - It names no prop: it is scored against the required prop whose acceptable keys it returned most of, and every other
//   key is wrong. If no key is acceptable for any required prop, it is an extra, listed and never counted wrong.
// A misfiled key does not make its prop found.
function scoredAgainst(prop, fixture) {
  if (fixture.absent.some((name) => namesAll(prop.prop, name))) return { forceMatch: true };
  const named = fixture.required.filter((expected) => namesAll(prop.prop, expected.prop));
  if (named.length) return { against: named, misfiles: named.length > 1 };
  let best = null;
  for (const expected of fixture.required) {
    const rank = [prop.keys.filter((key) => expected.acceptableKeys.includes(key)).length, sharedWords(prop.prop, expected.prop)];
    if (!rank[0]) continue;
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { expected, rank };
  }
  return best ? { against: [best.expected], misfiles: false } : {};
}

export function score(fixture, body) {
  const props = [...body.required.map((prop) => ({ ...prop, list: 'R' })), ...body.optional.map((prop) => ({ ...prop, list: 'O' }))]
    .filter((prop) => prop.keys.length)
    .map((prop) => ({ ...prop, ...scoredAgainst(prop, fixture) }));
  const dense = fixture.required.length + fixture.absent.length > SLOTS;
  const foundBy = new Map(fixture.required.map((expected) => [expected, new Set()]));
  const wrongKeys = [];
  const misfiled = [];
  const extras = [];
  const setDressing = [];
  for (const prop of props) {
    if (prop.forceMatch) {
      for (const key of prop.keys) wrongKeys.push(`${prop.prop}: ${key}`);
    } else if (prop.against) {
      for (const key of prop.keys) {
        const fits = prop.against.filter((expected) => expected.acceptableKeys.includes(key));
        for (const expected of fits) foundBy.get(expected).add(prop.list);
        const elsewhere = fits.length || !prop.misfiles ? [] : fixture.required.filter((expected) => expected.acceptableKeys.includes(key));
        if (elsewhere.length) misfiled.push({ prop: prop.prop, key, for: elsewhere.map((expected) => expected.prop) });
        else if (!fits.length) wrongKeys.push(`${prop.prop}: ${key}`);
      }
    } else if (prop.list === 'R') {
      extras.push({ prop: prop.prop, keys: prop.keys });
    } else {
      setDressing.push(`${prop.prop} [${prop.keys.join(', ')}]`);
    }
  }
  const required = fixture.required.map((expected) => ({
    prop: expected.prop,
    found: foundBy.get(expected).size > 0,
    asRequired: foundBy.get(expected).has('R'),
  }));
  const listed = [...body.required, ...body.optional];
  const absent = fixture.absent.map((name) => {
    const prop = listed.find((entry) => namesAll(entry.prop, name));
    if (!prop) return { name, outcome: 'left out' };
    return { name, outcome: prop.keys.length ? `force-matched (${prop.keys.join(', ')})` : 'reported as no match' };
  });
  const found = required.filter((entry) => entry.found).length;
  return {
    dense,
    required,
    absent,
    found,
    counted: dense ? Math.min(found, LIMITS.maxRequiredProps) : found,
    countable: dense ? Math.min(required.length, LIMITS.maxRequiredProps) : required.length,
    honest: absent.filter((entry) => entry.outcome === 'reported as no match').length,
    wrongKeys,
    misfiled,
    extras,
    setDressing,
    withKeys: props.length,
  };
}
