const MAX_TAGS = 6;
const TAG_SHAPE = /^[a-z0-9][a-z0-9 '&/.-]{1,31}$/;
const DENIED_WORDS = new Set([
  'price', 'priced', 'cost', 'cheap', 'expensive', 'sale', 'available', 'availability', 'working', 'works',
  'functional', 'broken', 'inch', 'inches', 'cm', 'feet', 'ft', 'size', 'sizes',
]);
const PRINTED_MATTER = new Set(['book', 'books', 'handbook', 'manual', 'directory', 'magazine', 'magazines', 'newspaper', 'pages', 'calendar']);
const UNPRINTED_WORDS = new Set(['notebook', 'notepad', 'planner', 'journal', 'logbook', 'ledger', 'diary', 'novel', 'paperback', 'hardcover', 'hardback']);
const CLAIM_WORDS = new Set(['training', 'official', 'authentic', 'genuine', 'issued']);
const IMITATION_WORDS = new Set(['prop', 'replica', 'airsoft', 'foam']);
const IMITATION_QUALIFIERS = new Set(['prop', 'replica', 'airsoft', 'toy']);
const PERIOD_WORDS = new Set([
  'twenties', 'thirties', 'forties', 'fifties', 'sixties', 'seventies', 'eighties', 'nineties',
  'vintage', 'retro', 'antique', 'era', 'period', 'midcentury', 'century', 'decade', 'decades',
  'victorian', 'edwardian', 'wwi', 'wwii', 'ww1', 'ww2', 'y2k', 'classic', 'modern', 'contemporary',
  'historic', 'historical',
]);

function wordsOf(text) {
  return text.toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9]+/).filter(Boolean);
}

export function cleanTags(rawTags, item) {
  const captionWords = new Set(wordsOf(item.description));
  const name = item.name.toLowerCase();
  const printed = [...captionWords].some((word) => PRINTED_MATTER.has(word));
  const imitation = [...captionWords].some((word) => IMITATION_WORDS.has(word));
  const kept = [];
  const rejected = [];
  for (const raw of Array.isArray(rawTags) ? rawTags : []) {
    const tag = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ') : '';
    const words = wordsOf(tag);
    const claimsPeriod = words.some((word) => (/\d/.test(word) || PERIOD_WORDS.has(word)) && !captionWords.has(word));
    const misreadsPrint = printed && words.some((word) => UNPRINTED_WORDS.has(word) && !captionWords.has(word));
    const claimsStatus = words.some((word) => CLAIM_WORDS.has(word) && !captionWords.has(word));
    const callsRealGun = imitation && words.some((word) => /^firearms?$/.test(word)) && !words.some((word) => IMITATION_QUALIFIERS.has(word));
    const valid = TAG_SHAPE.test(tag) && tag.split(' ').length <= 4 && !words.some((word) => DENIED_WORDS.has(word))
      && !claimsPeriod && !misreadsPrint && !claimsStatus && !callsRealGun && tag !== name && !kept.includes(tag);
    (valid ? kept : rejected).push(tag || String(raw));
  }
  return { tags: kept.slice(0, MAX_TAGS), rejected: [...rejected, ...kept.slice(MAX_TAGS)] };
}

export function serializeTags(file) {
  const entries = Object.keys(file.tags).sort().map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(file.tags[key])}`);
  const header = JSON.stringify({ schemaVersion: file.schemaVersion, generator: file.generator, generatedAt: file.generatedAt }, null, 2)
    .replace(/\n}$/, '');
  return `${header},\n  "tags": {\n${entries.join(',\n')}\n  }\n}\n`;
}
