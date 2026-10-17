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

export function tokenize(text) {
  return String(text).toLowerCase().replace(/['’‘]/g, '').split(/[^a-z0-9]+/).filter(Boolean).map(stem);
}

export function parseDecades(query) {
  const decades = new Set();
  const text = String(query).toLowerCase().replace(/[’‘]/g, "'");
  for (const [, digits] of text.matchAll(/\b(1[89]\d0|20[0-2]0)s?\b/g)) decades.add(Number(digits));
  for (const [, digits] of text.matchAll(/(?:^|[^\d])'?([2-9]0)s\b/g)) decades.add(1900 + Number(digits));
  for (const [, year] of text.matchAll(/\b(19\d\d|20[0-2]\d)\b/g)) decades.add(Math.floor(Number(year) / 10) * 10);
  for (const word of text.split(/[^a-z]+/)) if (DECADE_WORDS[word]) decades.add(DECADE_WORDS[word]);
  return decades;
}

function queryTerms(query) {
  return [...new Set(tokenize(query).filter((token) => !STOPWORDS.has(token) && !/^\d0s?$/.test(token)))];
}

export function compareByName(a, b) {
  return a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key, 'en');
}

export function buildIndex(docs) {
  const entries = docs.map((doc) => ({
    doc,
    fields: Object.fromEntries(Object.keys(FIELD_WEIGHTS).map((field) => [
      field, new Set(tokenize(Array.isArray(doc[field]) ? doc[field].join(' ') : doc[field] ?? '')),
    ])),
  }));
  const documentFrequency = new Map();
  for (const entry of entries) {
    const seen = new Set(Object.values(entry.fields).flatMap((tokens) => [...tokens]));
    for (const token of seen) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  return { entries, documentFrequency, alphabetical: [...docs].sort(compareByName) };
}

function termScore(entry, term, index) {
  let best = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const tokens = entry.fields[field];
    if (tokens.has(term)) best = Math.max(best, weight);
    else if (term.length >= 4 && [...tokens].some((token) => token.startsWith(term))) best = Math.max(best, weight * PREFIX_FACTOR);
  }
  if (!best) return 0;
  const matching = index.documentFrequency.get(term) ?? 1;
  return best * Math.log(1 + index.entries.length / matching);
}

export function search(index, query = '', { category = '', decade = '' } = {}) {
  const passes = (doc) => (!category || doc.categories.includes(category)) && (!decade || doc.decades.includes(Number(decade)));
  const terms = queryTerms(query);
  const decades = parseDecades(query);
  if (!terms.length && !decades.size) return index.alphabetical.filter(passes);
  const scored = [];
  for (const entry of index.entries) {
    if (!passes(entry.doc)) continue;
    let score = 0;
    for (const term of terms) score += termScore(entry, term, index);
    const inDecade = entry.doc.decades.some((value) => decades.has(value));
    if (!terms.length) score = inDecade ? 1 : 0;
    else if (inDecade) score *= DECADE_BOOST;
    if (score > 0) scored.push({ doc: entry.doc, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.doc.order - b.doc.order).map(({ doc }) => doc);
}
