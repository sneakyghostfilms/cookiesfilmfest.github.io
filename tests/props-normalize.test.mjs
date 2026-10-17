import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildItems, checkItems, decadesOf, displayEra, isEraLine, replaceCatalog, serializeInventory, splitEra,
} from '../scripts/props/normalize.mjs';
import { cleanTags, reusableTags, serializeTags, tagFingerprint } from '../scripts/props/tags.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/props-cards.json', import.meta.url), 'utf8'));
const vendor = { id: 'steel-city-props', keyPrefix: 'scp' };
const catalog = { id: 'scp-test' };
const items = buildItems(fixture, { vendor, catalog });
const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
const sectionTitles = fixture.sections.map((section) => section.title);

test('every era form printed in the catalog is recognised as an era line', () => {
  const eras = ['1960S', '1990S', '2000S', '1980S', '2010S', '1970S', '1960S STYLE', '1960S/70S', '1960S/70S STYLE',
    '1980S - 2000S', '1980', '1982', '1991', '1997', '2010', '07/11/1991', 'WWII ERA', 'Y2K STYLE'];
  for (const era of eras) assert.ok(isEraLine(era), era);
  for (const line of ['DECOR', 'BOOK', 'MAGAZINES', 'RESTAURANT STYLE', 'YELLOW PAGES 1993', 'SEPT 2011 MAGAZINES', '8X21', '9MM PROP GUN', 'UNOPENED, 2000S']) {
    assert.ok(!isEraLine(line), line);
  }
});

test('splitEra takes a whole last-line era or a trailing ", era" and leaves everything else in the name', () => {
  assert.deepEqual(splitEra(['GREEN CHANGE', 'MACHINE', '1960S']), { nameLines: ['GREEN CHANGE', 'MACHINE'], era: '1960S', separator: ' ' });
  assert.deepEqual(splitEra(['BAZOOKA BUBBLE GUM', 'UNOPENED, 2000S']), { nameLines: ['BAZOOKA BUBBLE GUM', 'UNOPENED'], era: '2000S', separator: ', ' });
  assert.deepEqual(splitEra(['GOLDEN SCALES', 'DECOR']), { nameLines: ['GOLDEN SCALES', 'DECOR'], era: null, separator: null });
  assert.deepEqual(splitEra(['1960S']), { nameLines: ['1960S'], era: null, separator: null });
});

test('decades come only from digits in the stated era', () => {
  const cases = {
    '1960S': [1960], '1960S/70S': [1960, 1970], '1960S/70S STYLE': [1960, 1970], '1980S - 2000S': [1980, 1990, 2000],
    '1982': [1980], '2010': [2010], '07/11/1991': [1990], 'WWII ERA': [], 'Y2K STYLE': [],
  };
  for (const [era, decades] of Object.entries(cases)) assert.deepEqual(decadesOf(era), decades, era);
  assert.deepEqual(decadesOf(null), []);
});

test('displayEra only lowercases an S that follows digits', () => {
  assert.equal(displayEra('1960S/70S'), '1960s/70s');
  assert.equal(displayEra('1960S STYLE'), '1960s STYLE');
  assert.equal(displayEra('1980S - 2000S'), '1980s - 2000s');
  assert.equal(displayEra('WWII ERA'), 'WWII ERA');
  assert.equal(displayEra('07/11/1991'), '07/11/1991');
});

test('names and descriptions keep the caption exactly as printed', () => {
  assert.equal(byKey['scp-056'].name, 'GREEN CHANGE MACHINE');
  assert.equal(byKey['scp-056'].description, 'GREEN CHANGE MACHINE 1960S');
  assert.equal(byKey['scp-348'].name, 'JUICYFRUIT PLENT-PAK BUBBLDE GUM,');
  assert.equal(byKey['scp-336'].name, 'BAZOOKA BUBBLE GUM UNOPENED');
  assert.equal(byKey['scp-336'].era, '2000S');
  assert.equal(byKey['scp-118'].name, 'STEN MACHINE PROP GUN REPLICA,');
  assert.equal(byKey['scp-035'].era, null);
  assert.equal(byKey['scp-362'].description, 'HEAVY DUTY FIRST RESPONDERS HI-VIS JACKET');
});

test('keys stay unique when the vendor reuses a number, and identical cards merge', () => {
  assert.equal(byKey['scp-027'].pages.length, 1);
  assert.deepEqual(byKey['scp-027'].pages, [6]);
  assert.equal(byKey['scp-286-1'].name, 'BLACK OFFICE PHONE');
  assert.equal(byKey['scp-286-2'].name, 'COKER TIRE NEWSPAPER');
  assert.equal(byKey['scp-054-1'].name, 'BLACK ROTARY PHONE');
  assert.equal(byKey['scp-054-2'].name, 'ALL-BLACK ROTARY PHONE');
  assert.equal(byKey['scp-108-1'].name, 'BEIGE SOVIET ERA GAS MASK');
  assert.deepEqual(byKey['scp-108-2'].pages, [31, 33]);
  assert.deepEqual(byKey['scp-108-2'].categories, ['UNIFORMS', 'MENSWEAR']);
  assert.ok(!('scp-108' in byKey) && !('scp-054' in byKey) && !('scp-286' in byKey));
  assert.equal(items.length, fixture.cards.length - 2);
  assert.equal(new Set(items.map((item) => item.key)).size, items.length);
});

test('multi-number cards, malformed printed IDs and unnumbered cards are kept as printed', () => {
  assert.deepEqual(byKey['scp-015-017-016'].itemNumbers, ['015', '017', '016']);
  assert.deepEqual(byKey['scp-132'].printedIds, ['[132']);
  assert.deepEqual(byKey['scp-284'].printedIds, ['284']);
  assert.deepEqual(byKey['scp-noid-1'].itemNumbers, []);
});

test('categories come from the nearest preceding section divider', () => {
  assert.deepEqual(byKey['scp-056'].categories, ['THE OFFICE']);
  assert.deepEqual(byKey['scp-348'].categories, ['HOUSEWARES']);
  assert.deepEqual(byKey['scp-118'].categories, ['WEAPONS']);
  assert.deepEqual(byKey['scp-284'].categories, ['MISCELLANEOUS']);
});

test('items keep first-appearance order in the catalog', () => {
  assert.deepEqual(items.slice(0, 4).map((item) => item.key), ['scp-056', 'scp-027', 'scp-035', 'scp-286-1']);
});

test('checkItems accepts built items and reports each kind of broken item', () => {
  assert.deepEqual(checkItems(items, { pageCount: 49, sectionTitles }), []);
  const broken = (change) => checkItems([{ ...structuredClone(byKey['scp-056']), ...change }], { pageCount: 49, sectionTitles });
  assert.match(broken({ pages: [50] }).join(), /page outside/);
  assert.match(broken({ categories: ['OFFICE'] }).join(), /section divider/);
  assert.match(broken({ name: 'Green Change Machine' }).join(), /rebuild the description/);
  assert.match(broken({ decades: [1970] }).join(), /decades/);
  assert.match(broken({ itemNumbers: ['065'] }).join(), /item numbers/);
  assert.match(checkItems([byKey['scp-056'], byKey['scp-056']], { pageCount: 49, sectionTitles }).join(), /duplicate key/);
});

test('importing a catalog under a new id replaces the catalog it supersedes and keeps other listed catalogs', () => {
  const item = (key, catalog) => ({ key, catalog, name: key.toUpperCase() });
  const existing = {
    schemaVersion: 1,
    catalogs: { 'scp-2026-09-30': { cards: 2 }, 'abc-2026': { cards: 1 } },
    items: [item('scp-001', 'scp-2026-09-30'), item('scp-002', 'scp-2026-09-30'), item('abc-001', 'abc-2026')],
  };
  const fresh = [item('scp-001', 'scp-2027-01-15'), item('scp-003', 'scp-2027-01-15')];
  const listedCatalogIds = new Set(['scp-2027-01-15', 'abc-2026']);
  const replaced = replaceCatalog(existing, { catalogId: 'scp-2027-01-15', items: fresh, entry: { cards: 2 }, listedCatalogIds });
  assert.deepEqual(Object.keys(replaced.catalogs), ['abc-2026', 'scp-2027-01-15']);
  assert.deepEqual(replaced.items.map((entry) => `${entry.key}@${entry.catalog}`), ['abc-001@abc-2026', 'scp-001@scp-2027-01-15', 'scp-003@scp-2027-01-15']);
  const again = replaceCatalog(replaced, { catalogId: 'scp-2027-01-15', items: [fresh[0]], entry: { cards: 1 }, listedCatalogIds });
  assert.deepEqual(again.items.map((entry) => entry.key), ['abc-001', 'scp-001']);
  assert.deepEqual(again.catalogs['scp-2027-01-15'], { cards: 1 });
});

test('serializeInventory writes one item per line and round-trips', () => {
  const inventory = { schemaVersion: 1, catalogs: { 'scp-test': { indexedAt: '2026-10-17' } }, items };
  const text = serializeInventory(inventory);
  assert.deepEqual(JSON.parse(text), inventory);
  assert.equal(text.split('\n').filter((line) => line.startsWith('    {"key"')).length, items.length);
});

test('cleanTags rejects era claims the caption does not make, denied words and malformed tags', () => {
  const dated = { name: 'GREEN CHANGE MACHINE', description: 'GREEN CHANGE MACHINE 1960S' };
  const undated = { name: 'WHITE MEGA PHONE', description: 'WHITE MEGA PHONE' };
  const vintage = { name: 'VINTAGE STETHOSCOPE', description: 'VINTAGE STETHOSCOPE' };
  assert.deepEqual(cleanTags(['coin changer', '1960s office'], dated).tags, ['coin changer', '1960s office']);
  assert.deepEqual(cleanTags(['megaphone', '1960s megaphone', 'vintage bullhorn', 'retro', 'antique horn', 'mid-century'], undated).tags, ['megaphone']);
  assert.deepEqual(cleanTags(['vintage medical tool', 'doctor tool'], vintage).tags, ['vintage medical tool', 'doctor tool']);
  assert.deepEqual(cleanTags(['cheap megaphone', 'working megaphone', 'size large', 'Bullhorn', 'bullhorn', 'white mega phone', '', 7, 'a very long tag with too many words', '<b>x</b>'], undated).tags, ['bullhorn']);
  assert.deepEqual(cleanTags(['bullhorn', 'model 9', '2000s phone'], undated).tags, ['bullhorn']);
  assert.deepEqual(cleanTags(['9mm pistol', 'colt 45'], { name: '9MM COLT .45 PROP GUN', description: '9MM COLT .45 PROP GUN' }).tags, ['9mm pistol', 'colt 45']);
  assert.equal(cleanTags(['one', 'two', 'three', 'four', 'five', 'six', 'seven'], undated).tags.length, 6);
  assert.deepEqual(cleanTags(null, undated), { tags: [], rejected: [] });
});

test('cleanTags keeps printed matter from being tagged as blank stationery or a guessed genre', () => {
  const book = { name: 'GRAY BOOK', description: 'GRAY BOOK 1960S' };
  const notebook = { name: 'STENO SPIRAL NOTEBOOK', description: 'STENO SPIRAL NOTEBOOK 1990S' };
  assert.deepEqual(cleanTags(['notebook', 'reference book', 'novel', 'logbook', 'paperback'], book).tags, ['reference book']);
  assert.deepEqual(cleanTags(['steno pad', 'notebook'], notebook).tags, ['steno pad', 'notebook']);
});

test('cleanTags keeps imitation guns from being called firearms and rejects status claims the caption does not make', () => {
  const propGun = { name: 'GLOCK PROP GUN', description: 'GLOCK PROP GUN' };
  assert.deepEqual(cleanTags(['firearm', 'replica firearm', 'prop firearm', 'handgun', 'training weapon'], propGun).tags, ['replica firearm', 'prop firearm', 'handgun']);
  assert.deepEqual(cleanTags(['firearms', 'airsoft firearm'], { name: 'AIRSOFT AEG RIFLE', description: 'AIRSOFT AEG RIFLE' }).tags, ['airsoft firearm']);
  assert.deepEqual(cleanTags(['official cap', 'coroner cap', 'authentic badge', 'issued badge'], { name: 'BLACK CORONER BASEBALL CAP', description: 'BLACK CORONER BASEBALL CAP' }).tags, ['coroner cap']);
  assert.deepEqual(cleanTags(['training manual'], { name: 'POLICE TRAINING MANUAL', description: 'POLICE TRAINING MANUAL' }).tags, ['training manual']);
});

test('serializeTags writes sorted keys, one per line, and round-trips', () => {
  const file = {
    schemaVersion: 2, generator: { tool: 'ollama', model: 'm', promptVersion: 1 }, generatedAt: '2026-10-17',
    tags: { 'scp-2': ['b'], 'scp-1': ['a'] }, fingerprints: { 'scp-2': 'f2', 'scp-1': 'f1' },
  };
  const text = serializeTags(file);
  assert.deepEqual(JSON.parse(text), file);
  assert.ok(text.indexOf('"scp-1"') < text.indexOf('"scp-2"'));
});

test('tags are reused only while the name, section and era they were made from are unchanged', () => {
  const machine = { key: 'scp-056', name: 'GREEN CHANGE MACHINE', categories: ['THE OFFICE'], era: '1960S' };
  const phone = { key: 'scp-055', name: 'WHITE ROTARY PHONE', categories: ['THE OFFICE'], era: '1960S' };
  const previous = {
    tags: { 'scp-056': ['coin changer'], 'scp-055': ['telephone'], 'scp-999': ['gone'] },
    fingerprints: { 'scp-056': tagFingerprint(machine), 'scp-055': tagFingerprint(phone), 'scp-999': 'x' },
  };
  const recaptioned = { ...phone, name: 'PINK ROTARY PHONE' };
  const reused = reusableTags(previous, [machine, recaptioned]);
  assert.deepEqual(reused.tags, { 'scp-056': ['coin changer'] });
  assert.deepEqual(reused.fingerprints, { 'scp-056': tagFingerprint(machine) });
  assert.notEqual(tagFingerprint({ ...machine, categories: ['HOUSEWARES'] }), tagFingerprint(machine));
  assert.notEqual(tagFingerprint({ ...machine, era: null }), tagFingerprint(machine));
  assert.deepEqual(reusableTags({ tags: { 'scp-056': ['coin changer'] } }, [machine]).tags, {}, 'tags without a fingerprint are regenerated');
});
