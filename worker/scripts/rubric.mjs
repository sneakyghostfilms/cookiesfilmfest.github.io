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

// A suggestion is judged against the fixture prop it names in full, required or absent: the longest name wins, then a
// required prop over an absent one, then the one more of its keys fit. Otherwise it is judged against the required prop
// whose acceptable keys it returned most of. A suggestion that does neither is an extra: listed, never counted wrong.
function judge(prop, fixture) {
  const fitting = (expected) => prop.keys.filter((key) => expected.acceptableKeys.includes(key)).length;
  const named = [
    ...fixture.required.filter((expected) => namesAll(prop.prop, expected.prop))
      .map((expected) => ({ expected, length: words(expected.prop).length, absent: 0, fit: fitting(expected) })),
    ...fixture.absent.filter((name) => namesAll(prop.prop, name))
      .map((name) => ({ absentName: name, length: words(name).length, absent: 1, fit: 0 })),
  ].sort((a, b) => b.length - a.length || a.absent - b.absent || b.fit - a.fit);
  if (named.length) return named[0].expected ? { expected: named[0].expected } : { absentName: named[0].absentName };
  let best = null;
  for (const expected of fixture.required) {
    const rank = [fitting(expected), sharedWords(prop.prop, expected.prop)];
    if (!rank[0]) continue;
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { expected, rank };
  }
  return best ? { expected: best.expected } : {};
}

export function score(fixture, body) {
  const props = [...body.required.map((prop) => ({ ...prop, list: 'R' })), ...body.optional.map((prop) => ({ ...prop, list: 'O' }))]
    .filter((prop) => prop.keys.length)
    .map((prop) => ({ ...prop, ...judge(prop, fixture) }));
  const dense = fixture.required.length + fixture.absent.length > SLOTS;
  const matches = (prop, expected) => prop.expected === expected && prop.keys.some((key) => expected.acceptableKeys.includes(key));
  const required = fixture.required.map((expected) => ({
    prop: expected.prop,
    found: props.some((prop) => matches(prop, expected)),
    asRequired: props.some((prop) => prop.list === 'R' && matches(prop, expected)),
  }));
  const wrongKeys = [];
  const extras = [];
  const setDressing = [];
  for (const prop of props) {
    if (prop.expected) {
      for (const key of prop.keys) if (!prop.expected.acceptableKeys.includes(key)) wrongKeys.push(`${prop.prop}: ${key}`);
    } else if (prop.absentName) {
      for (const key of prop.keys) wrongKeys.push(`${prop.prop}: ${key}`);
    } else if (prop.list === 'R') {
      extras.push({ prop: prop.prop, keys: prop.keys });
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
    extras,
    setDressing,
    withKeys: props.length,
  };
}
