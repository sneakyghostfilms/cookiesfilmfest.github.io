import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIndex, compareByName, parseDecades, queryTerms, rankText, sceneTermMatches, search, stem, tokenize } from '../src/scripts/props-search.js';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const inventory = await read('../src/data/props/inventory.json');
const tagsFile = await read('../src/data/props/tags.json');
const docs = inventory.items.map((item, order) => ({
  key: item.key,
  name: item.name,
  description: item.description,
  categories: item.categories,
  tags: tagsFile.tags[item.key] ?? [],
  decades: item.decades,
  vendor: item.vendor,
  order,
}));
const index = buildIndex(docs);
const keys = (query, filters) => search(index, query, filters).map((doc) => doc.key);

test('tokenize lowercases, drops apostrophes and lightly stems', () => {
  assert.deepEqual(tokenize('SECRETARY’S Phones, boxes & dress'), ['secretary', 'phone', 'box', 'dress']);
  assert.equal(stem('glasses'), 'glass');
  assert.equal(stem('batteries'), 'battery');
  assert.equal(stem('gas'), 'gas');
});

test('parseDecades understands the ways people write a decade', () => {
  const decades = (query) => [...parseDecades(query)].sort();
  assert.deepEqual(decades('a phone from the 60s'), [1960]);
  assert.deepEqual(decades("'70s lamp"), [1970]);
  assert.deepEqual(decades('1960s office'), [1960]);
  assert.deepEqual(decades('sixties diner'), [1960]);
  assert.deepEqual(decades('a 1965 car'), [1960]);
  assert.deepEqual(decades('2000s flip phone'), [2000]);
  assert.deepEqual(decades('police jacket size 40'), []);
});

test('with no query the full list comes back alphabetically by name', () => {
  assert.deepEqual(keys(''), [...docs].sort(compareByName).map((doc) => doc.key));
  assert.deepEqual(keys('a the for some'), keys(''));
});

test('alphabetical order ignores opening quotes but keeps digits first', () => {
  const names = ['“JADE” NAME TAG', 'HOSPITAL BLANKET', '24 QT IGLOO COOLER', 'JUDGE’S WOODEN GAVEL', '“GEORGE ADAMS’” NAME TAG'];
  const sorted = names.map((name, index) => ({ name, key: `k${index}` })).sort(compareByName).map((entry) => entry.name);
  assert.deepEqual(sorted, ['24 QT IGLOO COOLER', '“GEORGE ADAMS’” NAME TAG', 'HOSPITAL BLANKET', '“JADE” NAME TAG', 'JUDGE’S WOODEN GAVEL']);
});

const top = (query, count) => keys(query).slice(0, count);

test('keyword queries rank the matching items first', () => {
  assert.deepEqual(top('rotary phone', 5).sort(), ['scp-054-1', 'scp-054-2', 'scp-055', 'scp-134', 'scp-296']);
  assert.deepEqual(top('typewriter', 4).sort(), ['scp-077', 'scp-078', 'scp-079', 'scp-331']);
  assert.equal(keys('change machine')[0], 'scp-056');
  assert.equal(keys('telephone book')[0], 'scp-051');
  assert.equal(keys('secretary handbook')[0], 'scp-024');
  assert.deepEqual(top('handcuffs', 2).sort(), ['scp-142', 'scp-280']);
  assert.deepEqual(keys('santa').sort(), ['cps-7o625i', 'pccr-w9w5ab', 'scp-210', 'scp-370', 'va-lnoa73'], "Steel City's two Santa costumes, Vintage Alley's Santa's Chair, Creative Reuse's Santa tea towel and Cleveland Prop Shop's Santa throne");
  assert.deepEqual(keys('wig'), ['scp-082', 'cps-9tpny1', 'cps-cn4eli', 'cps-we3uxs']);
  assert.equal(keys('fake blood')[0], 'scp-057');
  for (const key of ['scp-204', 'scp-236', 'scp-237']) assert.ok(top('police jacket', 3).includes(key), key);
  for (const doc of search(index, 'gun').slice(0, 10)) assert.match(doc.name, /GUN/);
  assert.deepEqual(top('cell phone', 2).sort(), ['cps-7y9yme', 'cps-bu6xfl']);
  assert.ok(keys('secret').includes('scp-021'), 'prefix match');
  assert.deepEqual(keys('zzqx nonsense'), []);
});

test('AI tags extend keyword search to synonyms the vendor did not print', () => {
  assert.deepEqual(keys('megaphone').sort(), ['cps-aafudh', 'scp-284', 'scp-372'], 'the two MEGA PHONEs through their tags, and one that prints the word');
  assert.equal(keys('coin changer')[0], 'scp-056');
});

test('decades boost dated items and decade-only queries return that decade', () => {
  const sixties = keys('60s');
  assert.ok(sixties.length > 0);
  for (const key of sixties) assert.ok(docs.find((doc) => doc.key === key).decades.includes(1960), key);
  assert.equal(keys('telephone book from the 60s')[0], 'scp-051');
});

test('decade words work like decade numbers', () => {
  for (const [word, digits] of [['sixties', '60s'], ['seventies', '70s'], ['eighties', '80s'], ['nineties', '90s']]) {
    assert.ok(keys(digits).length > 0, digits);
    assert.deepEqual(keys(word), keys(digits), word);
  }
  assert.deepEqual(keys('sixties rotary phone').slice(0, 3), keys('60s rotary phone').slice(0, 3));
  const fifty = buildIndex([{ key: 'bill', name: 'FIFTY DOLLAR BILL', description: 'FIFTY DOLLAR BILL', categories: [], tags: [], decades: [], order: 0 }]);
  assert.deepEqual(search(fifty, 'fifty').map((doc) => doc.key), ['bill'], 'a number word that is not a decade stays a search term');
  assert.deepEqual([...parseDecades('constructor toString')], []);
});

test('filters narrow by section and stated decade', () => {
  const misc = keys('', { category: 'MISCELLANEOUS' });
  assert.deepEqual(misc, docs.filter((doc) => doc.categories.includes('MISCELLANEOUS')).sort(compareByName).map((doc) => doc.key));
  assert.ok(keys('', { decade: '1960' }).every((key) => docs.find((doc) => doc.key === key).decades.includes(1960)));
  assert.deepEqual(keys('jacket', { category: 'THE OFFICE' }), []);
});

test('a bare year finds its decade unless the year itself is printed', () => {
  const year = keys('1965');
  const printing1965 = ['cps-9c731j', 'cps-xu219g'];
  assert.ok(year.length > 0);
  assert.deepEqual(year.slice(0, printing1965.length).sort(), printing1965, 'the items that print 1965 come first');
  assert.deepEqual(year.slice(printing1965.length), keys('60s').filter((key) => !printing1965.includes(key)));
  assert.deepEqual(top('1991', 4).sort(), ['cps-e1m182', 'cps-xiq7y4', 'pccr-1nfvei', 'scp-342'], 'the four items that print 1991');
  const printed = buildIndex([
    { key: 'calendar', name: 'PIN-UP CALENDAR 1991', description: 'PIN-UP CALENDAR 1991', categories: [], tags: [], decades: [], order: 0 },
    { key: 'phone', name: 'CORDLESS PHONE', description: 'CORDLESS PHONE 1990S', categories: [], tags: [], decades: [1990], order: 1 },
  ]);
  assert.deepEqual(search(printed, '1991').map((doc) => doc.key), ['calendar', 'phone']);
});

test('items matching every query word outrank stronger single-word matches', () => {
  const filler = Array.from({ length: 6 }, (_, order) => ({ key: `police-${order}`, name: `POLICE ITEM ${order}`, description: `POLICE ITEM ${order}`, categories: [], tags: [], decades: [], order: order + 2 }));
  const local = buildIndex([
    { key: 'nurse', name: 'NURSE SMOCK JACKETS', description: 'NURSE SMOCK JACKETS', categories: [], tags: [], decades: [], order: 0 },
    { key: 'uniform', name: 'BLUE UNIFORM', description: 'BLUE UNIFORM POLICE JACKET', categories: [], tags: [], decades: [], order: 1 },
    ...filler,
  ]);
  assert.deepEqual(search(local, 'police jacket').slice(0, 2).map((doc) => doc.key), ['uniform', 'nurse']);
});

const REFERENCE_WEIGHTS = { name: 3, description: 2, categories: 1, tags: 1 };

function referenceTermScore(entry, term, index) {
  let best = 0;
  for (const [field, weight] of Object.entries(REFERENCE_WEIGHTS)) {
    const tokens = entry.fields[field];
    if (tokens.has(term)) best = Math.max(best, weight);
    else if (term.length >= 4 && [...tokens].some((token) => token.startsWith(term))) best = Math.max(best, weight * 0.7);
  }
  if (!best) return 0;
  const matching = index.documentFrequency.get(term) ?? 1;
  return best * Math.log(1 + index.entries.length / matching);
}

function referenceSearch(index, query = '', { category = '', decade = '', vendor = '' } = {}, decades = parseDecades(query)) {
  const passes = (doc) => (!category || doc.categories.includes(category)) && (!decade || doc.decades.includes(Number(decade)))
    && (!vendor || doc.vendor === vendor);
  const terms = queryTerms(query);
  const isYear = (term) => /^(19|20)\d\d$/.test(term);
  const words = terms.filter((term) => !isYear(term));
  const years = terms.filter((term) => isYear(term) && index.documentFrequency.has(term));
  if (!words.length && !years.length && !decades.size) return index.alphabetical.filter(passes);
  const scored = [];
  for (const entry of index.entries) {
    if (!passes(entry.doc)) continue;
    let score = 0;
    let matched = 0;
    for (const term of words) {
      const value = referenceTermScore(entry, term, index);
      score += value;
      if (value > 0) matched += 1;
    }
    if (words.length) score *= matched / words.length;
    for (const term of years) score += referenceTermScore(entry, term, index);
    const inDecade = entry.doc.decades.some((value) => decades.has(value));
    if (!words.length) score += inDecade ? 1 : 0;
    else if (inDecade) score *= 1.5;
    if (score > 0) scored.push({ doc: entry.doc, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.doc.order - b.doc.order).map(({ doc }) => doc);
}

const scenes = await Promise.all(['diner', 'hospital', 'office', 'police'].map((id) => read(`../worker/test/fixtures/scenes/${id}.json`)));

function fixedQueries(vocabulary, count) {
  let seed = 20261017;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const extras = ['60s', '1991', 'sixties', 'the', 'phone', 'police jacket'];
  return Array.from({ length: count }, () => {
    const words = Array.from({ length: 2 + (next() % 2) }, () => vocabulary[next() % vocabulary.length]);
    if (next() % 4 === 0) words.push(extras[next() % extras.length]);
    return words.join(' ');
  });
}

test('the inverted index returns exactly what the brute-force ranking returned', () => {
  const keysOf = (results) => results.map((doc) => doc.key);
  const queries = [...index.vocabulary, ...fixedQueries(index.vocabulary, 200), ...scenes.map((scene) => scene.text), '', '1965', 'sixties'];
  for (const query of queries) assert.deepEqual(keysOf(search(index, query)), keysOf(referenceSearch(index, query)), query);
  const categories = [...new Set(docs.flatMap((doc) => doc.categories))].slice(0, 3);
  for (const query of index.vocabulary.filter((_, position) => position % 50 === 0)) {
    for (const filters of [...categories.map((category) => ({ category })), { decade: '1960' }, { vendor: 'steel-city-props' }, { vendor: 'nobody' }]) {
      assert.deepEqual(keysOf(search(index, query, filters)), keysOf(referenceSearch(index, query, filters)), `${query} ${JSON.stringify(filters)}`);
    }
  }
});

test('scene ranking is the same keyword ranking, without a decade boost from the scene text', () => {
  for (const scene of scenes) {
    assert.deepEqual(rankText(index, scene.text).map((doc) => doc.key), referenceSearch(index, scene.text, {}, new Set()).map((doc) => doc.key), scene.id);
  }
  assert.ok(parseDecades(scenes.find((scene) => scene.id === 'office').text).size > 0, 'screenplay ages like (40s) would otherwise boost decades');
});

test('the vendor filter keeps one vendor', () => {
  assert.deepEqual(keys('', { vendor: 'steel-city-props' }), docs.filter((doc) => doc.vendor === 'steel-city-props').sort(compareByName).map((doc) => doc.key));
  assert.ok(keys('refrigerator', { vendor: 'dezzign-central' }).length > 0);
  assert.deepEqual(keys('refrigerator', { vendor: 'steel-city-props' }).filter((key) => key.startsWith('dz-')), []);
  assert.deepEqual(keys('phone', { vendor: 'nobody' }), []);
});

test('the vendor strip matches a vendor by its name or its own words, never by our type label', async () => {
  const { vendorSearchDoc } = await import('../src/scripts/props-cards.js');
  const { vendors } = JSON.parse(await readFile(new URL('../src/data/props/vendors.json', import.meta.url), 'utf8'));
  const listed = vendors.filter((vendor) => !vendor.catalogs.length);
  const vendorIndex = buildIndex(listed.map((vendor, order) => vendorSearchDoc(vendor, order)));
  const ids = (query) => rankText(vendorIndex, query).map((doc) => doc.key);
  assert.deepEqual(ids('antique'), ['wagon-wheel-antiques'], 'by its name, and not PCCR, whose type label says antiques');
  assert.deepEqual(ids('costume'), ['public-theater-costumes']);
  assert.deepEqual(ids('tents'), ['windswept'], 'by its own words');
  assert.deepEqual(ids('typewriters'), [], 'Cleveland Prop Shop, now with searchable items, leaves the strip');
  assert.deepEqual(ids('film'), ['pittsburgh-clo-construction-center'], 'a vendor with searchable items leaves the strip');
  assert.deepEqual(ids('the props'), [], 'stopwords alone match nothing');
  assert.deepEqual(ids(''), []);
  assert.ok(!ids('theater stock').includes('cleveland-play-house-props'), 'a type label is not search text');
});

test('sceneTermMatches lists the items each scene word matches, then each pair of adjacent words that match the same item', () => {
  const names = { a: 'Red Chair', b: 'Blue Chair', c: 'Red Lamp', d: 'Rotary Phone', e: 'Office Phone' };
  const small = buildIndex(Object.entries(names).map(([key, name], order) => ({ key, name, description: name, categories: [], tags: [], decades: [], order })));
  const terms = sceneTermMatches(small, 'The red chair by the rotary phone. A red chair again, then a chair chair, 1957.');
  assert.deepEqual(terms.map(({ term }) => term), ['red', 'chair', 'rotary', 'phone', 'again', 'then', 'red chair', 'chair rotary', 'rotary phone', 'phone red', 'chair again', 'again then', 'then chair'], 'words first, in scene order, then pairs in the order they first appear');
  const matches = Object.fromEntries(terms.map(({ term, keys }) => [term, [...keys].sort()]));
  assert.deepEqual(matches, {
    red: ['a', 'c'],
    chair: ['a', 'b'],
    rotary: ['d'],
    phone: ['d', 'e'],
    again: [],
    then: [],
    'red chair': ['a'],
    'chair rotary': [],
    'rotary phone': ['d'],
    'phone red': [],
    'chair again': [],
    'again then': [],
    'then chair': [],
  }, 'stopwords and years are skipped, a repeated pair is listed once, and a word next to itself is no pair');
  assert.deepEqual(sceneTermMatches(small, 'the and of'), []);
});
