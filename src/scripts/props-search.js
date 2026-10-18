const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'get', 'have', 'i', 'in', 'is', 'it',
  'looking', 'me', 'my', 'need', 'of', 'on', 'or', 'our', 'prop', 'props', 'scene', 'some', 'something', 'that',
  'the', 'this', 'to', 'want', 'we', 'with',
]);
const DECADE_WORDS = {
  twenties: 1920, thirties: 1930, forties: 1940, fifties: 1950, sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990,
};
const FIELD_WEIGHTS = { name: 3, description: 2, categories: 1, tags: 1 };
const PREFIX_FACTOR = 0.7;
const DECADE_BOOST = 1.5;

export function stem(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

const isDecadeWord = (word) => Object.hasOwn(DECADE_WORDS, word);

function wordsOf(text) {
  return String(text).toLowerCase().replace(/['’‘]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

export function tokenize(text) {
  return wordsOf(text).map(stem);
}

export function parseDecades(query) {
  const decades = new Set();
  const text = String(query).toLowerCase().replace(/[’‘]/g, "'");
  for (const [, digits] of text.matchAll(/\b(1[89]\d0|20[0-2]0)s?\b/g)) decades.add(Number(digits));
  for (const [, digits] of text.matchAll(/(?:^|[^\d])'?([2-9]0)s\b/g)) decades.add(1900 + Number(digits));
  for (const [, year] of text.matchAll(/\b(19\d\d|20[0-2]\d)\b/g)) decades.add(Math.floor(Number(year) / 10) * 10);
  for (const word of text.split(/[^a-z]+/)) if (isDecadeWord(word)) decades.add(DECADE_WORDS[word]);
  return decades;
}

export function queryTerms(query) {
  const tokens = wordsOf(query).filter((word) => !isDecadeWord(word)).map(stem);
  return [...new Set(tokens.filter((token) => !STOPWORDS.has(token) && !/^\d0s?$/.test(token)))];
}

const sortName = (name) => name.replace(/^[^\p{L}\p{N}]+/u, '');

export function compareByName(a, b) {
  return sortName(a.name).localeCompare(sortName(b.name), 'en') || a.key.localeCompare(b.key, 'en');
}

export function buildIndex(docs) {
  const entries = docs.map((doc) => ({
    doc,
    fields: Object.fromEntries(Object.keys(FIELD_WEIGHTS).map((field) => [
      field, new Set(tokenize(Array.isArray(doc[field]) ? doc[field].join(' ') : doc[field] ?? '')),
    ])),
  }));
  const documentFrequency = new Map();
  const postings = new Map();
  entries.forEach((entry, position) => {
    const seen = new Set();
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      for (const token of entry.fields[field]) {
        seen.add(token);
        if (!postings.has(token)) postings.set(token, []);
        postings.get(token).push([position, weight]);
      }
    }
    for (const token of seen) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  });
  return { entries, documentFrequency, postings, vocabulary: [...postings.keys()].sort(), alphabetical: [...docs].sort(compareByName) };
}

function firstAtOrAfter(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function termScores(index, term) {
  const best = new Map();
  const consider = (token, factor) => {
    for (const [position, weight] of index.postings.get(token) ?? []) {
      const value = weight * factor;
      if (value > (best.get(position) ?? 0)) best.set(position, value);
    }
  };
  consider(term, 1);
  if (term.length >= 4) {
    for (let at = firstAtOrAfter(index.vocabulary, term); at < index.vocabulary.length && index.vocabulary[at].startsWith(term); at += 1) {
      if (index.vocabulary[at] !== term) consider(index.vocabulary[at], PREFIX_FACTOR);
    }
  }
  const idf = Math.log(1 + index.entries.length / (index.documentFrequency.get(term) ?? 1));
  return [...best].map(([position, value]) => [position, value * idf]);
}

const isYear = (term) => /^(19|20)\d\d$/.test(term);

function splitTerms(index, terms) {
  return {
    words: terms.filter((term) => !isYear(term)),
    years: terms.filter((term) => isYear(term) && index.documentFrequency.has(term)),
  };
}

function rank(index, { words, years }, decades, passes) {
  const count = index.entries.length;
  const sums = new Float64Array(count);
  const matched = new Uint32Array(count);
  const touched = new Set();
  for (const term of words) {
    for (const [position, value] of termScores(index, term)) {
      sums[position] += value;
      if (value > 0) matched[position] += 1;
      touched.add(position);
    }
  }
  const yearScores = years.map((term) => new Map(termScores(index, term)));
  for (const scores of yearScores) for (const position of scores.keys()) touched.add(position);
  const scored = [];
  for (const position of words.length ? touched : index.entries.keys()) {
    const { doc } = index.entries[position];
    if (!passes(doc)) continue;
    let score = sums[position];
    if (words.length) score *= matched[position] / words.length;
    for (const scores of yearScores) score += scores.get(position) ?? 0;
    const inDecade = doc.decades.some((value) => decades.has(value));
    if (!words.length) score += inDecade ? 1 : 0;
    else if (inDecade) score *= DECADE_BOOST;
    if (score > 0) scored.push({ doc, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.doc.order - b.doc.order).map(({ doc }) => doc);
}

export function search(index, query = '', { category = '', decade = '', vendor = '' } = {}) {
  const passes = (doc) => (!category || doc.categories.includes(category)) && (!decade || doc.decades.includes(Number(decade)))
    && (!vendor || doc.vendor === vendor);
  const terms = splitTerms(index, queryTerms(query));
  const decades = parseDecades(query);
  if (!terms.words.length && !terms.years.length && !decades.size) return index.alphabetical.filter(passes);
  return rank(index, terms, decades, passes);
}

export function rankText(index, text) {
  return rank(index, splitTerms(index, queryTerms(text)), new Set(), () => true);
}

export function sceneTermMatches(index, text) {
  const { words } = splitTerms(index, queryTerms(text));
  const keysOf = new Map(words.map((term) => [term, termScores(index, term).map(([position]) => index.entries[position].doc.key)]));
  const sequence = tokenize(text).filter((token) => keysOf.has(token));
  const pairs = new Map();
  for (let at = 1; at < sequence.length; at += 1) {
    const term = `${sequence[at - 1]} ${sequence[at]}`;
    if (sequence[at - 1] === sequence[at] || pairs.has(term)) continue;
    const second = new Set(keysOf.get(sequence[at]));
    pairs.set(term, keysOf.get(sequence[at - 1]).filter((key) => second.has(key)));
  }
  return [...keysOf, ...pairs].map(([term, keys]) => ({ term, keys }));
}
