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

function expectedFor(prop, fixture) {
  let best = null;
  for (const expected of fixture.required) {
    const rank = [sharedWords(prop.prop, expected.prop), prop.keys.filter((key) => expected.acceptableKeys.includes(key)).length];
    if (!rank[0] && !rank[1]) continue;
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { expected, rank };
  }
  return best?.expected ?? null;
}

export function score(fixture, body) {
  const props = [...body.required.map((prop) => ({ ...prop, list: 'R' })), ...body.optional.map((prop) => ({ ...prop, list: 'O' }))]
    .filter((prop) => prop.keys.length)
    .map((prop) => ({ ...prop, expected: expectedFor(prop, fixture) }));
  const dense = fixture.required.length + fixture.absent.length > SLOTS;
  const matches = (prop, expected) => prop.expected === expected && prop.keys.some((key) => expected.acceptableKeys.includes(key));
  const required = fixture.required.map((expected) => ({
    prop: expected.prop,
    found: props.some((prop) => matches(prop, expected)),
    asRequired: props.some((prop) => prop.list === 'R' && matches(prop, expected)),
  }));
  const wrongKeys = [];
  const setDressing = [];
  for (const prop of props) {
    const { expected } = prop;
    if (expected) {
      for (const key of prop.keys) if (!expected.acceptableKeys.includes(key)) wrongKeys.push(`${prop.prop}: ${key}`);
    } else if (prop.list === 'R') {
      for (const key of prop.keys) wrongKeys.push(`${prop.prop}: ${key}`);
    } else {
      setDressing.push(`${prop.prop} [${prop.keys.join(', ')}]`);
    }
  }
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
    setDressing,
    withKeys: props.length,
  };
}
