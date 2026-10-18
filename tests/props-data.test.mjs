import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkItems } from '../scripts/props/normalize.mjs';
import { checkSiteItems } from '../scripts/props/site-items.mjs';
import { cleanTags, tagFingerprint } from '../scripts/props/tags.mjs';
import { contactRoutes } from '../src/scripts/props-cards.js';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const vendors = await read('../src/data/props/vendors.json');
const inventory = await read('../src/data/props/inventory.json');
const tagsFile = await read('../src/data/props/tags.json');
const byKey = new Map(inventory.items.map((item) => [item.key, item]));

const SOURCE_TYPES = new Set(['prop-house', 'vintage-rental', 'event-rental', 'antique-reuse', 'theater-stock', 'specialty']);
const MODES = new Set(['rent', 'sale', 'inquire']);
const FACT_FIELDS = ['sourceType', 'address', 'mailingAddress', 'hours', 'modes', 'terms', 'contact', 'social', 'inquiryHint', 'specialties', 'notice'];
const NAMED_ON_VENDOR_PAGES = [/\bPlunkett\b/, /sullivan/i, /\bRosenlieb\b/, /\bOcampo\b/, /\bCannon\b/, /\bCostanzo\b/, /\bStinebiser\b/, /dunhoff/i, /\bMia\b/];
const CATALOG_TYPES = new Set(['pdf', 'wordpress-pages', 'shopify-export']);

function keysOf(value, found = new Set()) {
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      keysOf(nested, found);
    }
  }
  return found;
}

test('vendors.json holds only facts each vendor publishes, every one with its source', () => {
  const keys = keysOf(vendors);
  assert.ok(!keys.has('permissions') && !keys.has('notes'), 'our relationship with a vendor belongs in the ignored .props-private/vendors.json');
  for (const vendor of vendors.vendors) {
    for (const field of ['id', 'name', 'siteUrl', 'contact', 'lastVerified', 'catalogs', ...FACT_FIELDS]) assert.ok(field in vendor, `${vendor.id} has no ${field}`);
    for (const field of FACT_FIELDS) {
      if (vendor[field] !== null) assert.match(vendor[field].source ?? '', /\S/, `${vendor.id} ${field} has no source`);
    }
    if (vendor.sourceType) assert.ok(SOURCE_TYPES.has(vendor.sourceType.value), `${vendor.id} sourceType`);
    if (vendor.modes) assert.ok(vendor.modes.values.length && vendor.modes.values.every((mode) => MODES.has(mode)), `${vendor.id} modes`);
    if (vendor.specialties) assert.ok(vendor.specialties.values.length && vendor.specialties.values.every((value) => /\S/.test(value)), `${vendor.id} specialties`);
    if (vendor.notice) assert.match(vendor.notice.text, /\S/, `${vendor.id} notice`);
    assert.match(vendor.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(contactRoutes(vendor.contact).length > 0, `${vendor.id} publishes no contact route`);
    assert.ok(Array.isArray(vendor.catalogs));
    if (vendor.catalogs.length) assert.match(vendor.keyPrefix, /^[a-z0-9]+$/);
    else assert.ok(!inventory.items.some((item) => item.vendor === vendor.id), `${vendor.id} lists no catalog but has items`);
  }
});

test('vendors.json names no person: owners and staff named on vendor pages stay out, e-mail addresses included', async () => {
  const raw = await readFile(new URL('../src/data/props/vendors.json', import.meta.url), 'utf8');
  for (const name of NAMED_ON_VENDOR_PAGES) assert.doesNotMatch(raw, name);
});

test('each catalog passes the import invariants and matches its expected counts', () => {
  for (const vendor of vendors.vendors) {
    for (const catalog of vendor.catalogs) {
      assert.ok(CATALOG_TYPES.has(catalog.type), `${catalog.id} type`);
      const entry = inventory.catalogs[catalog.id];
      assert.ok(entry, `inventory has no entry for ${catalog.id}`);
      const items = inventory.items.filter((item) => item.catalog === catalog.id);
      if (catalog.type === 'pdf') {
        const sectionTitles = entry.sections.map((section) => section.title);
        assert.deepEqual(checkItems(items, { pageCount: catalog.pageCount, sectionTitles }), []);
        assert.deepEqual({ cards: entry.cards, items: items.length, itemPages: entry.itemPages.length }, catalog.expected);
        assert.deepEqual([...new Set(items.flatMap((item) => item.pages))].sort((a, b) => a - b), entry.itemPages);
      } else {
        assert.deepEqual(checkSiteItems(items, { vendor, catalog }), []);
        const actual = catalog.type === 'wordpress-pages'
          ? { pages: entry.pages, photos: entry.photos, items: items.length }
          : { products: entry.products, items: items.length, excluded: entry.excluded };
        assert.deepEqual(actual, catalog.expected, catalog.id);
        assert.match(entry.capturedAt, /^\d{4}-\d{2}-\d{2}$/);
      }
      for (const item of items) {
        assert.equal(item.vendor, vendor.id, item.key);
        assert.ok(item.key.startsWith(`${vendor.keyPrefix}-`), item.key);
      }
    }
  }
  assert.equal(byKey.size, inventory.items.length, 'keys are unique across catalogs');
});

test('the spec example item keeps the vendor facts exactly as printed', () => {
  const item = byKey.get('scp-056');
  assert.deepEqual(
    { itemNumbers: item.itemNumbers, name: item.name, era: item.era, pages: item.pages, categories: item.categories },
    { itemNumbers: ['056'], name: 'GREEN CHANGE MACHINE', era: '1960S', pages: [5], categories: ['THE OFFICE'] },
  );
});

test('malformed printed IDs are preserved as vendor facts', () => {
  assert.deepEqual(byKey.get('scp-132').printedIds, ['[132']);
  assert.deepEqual(byKey.get('scp-103').printedIds, ['[103']);
  assert.deepEqual(byKey.get('scp-284').printedIds, ['284']);
});

test('numbers the vendor reused for different items get distinct keys, and repeated cards merge', () => {
  const pairs = {
    'scp-037': ['GOLDEN CIRCLE CLOCK', 'MISC 2010S MAGAZINES'],
    'scp-054': ['BLACK ROTARY PHONE', 'ALL-BLACK ROTARY PHONE'],
    'scp-108': ['BEIGE SOVIET ERA GAS MASK', 'PARK RANGER BUNDLE'],
    'scp-262': ['COLT REVOLVER PROP GUN', 'PROP KNIVES SET OF TWO'],
    'scp-283': ['ROYAL SOVEREIGN ELECTRIC BILL COUNTER', 'STOP N GO FOODS SM PAPER BAG'],
    'scp-286': ['BLACK OFFICE PHONE', 'COKER TIRE NEWSPAPER'],
  };
  for (const [base, names] of Object.entries(pairs)) {
    assert.deepEqual([byKey.get(`${base}-1`).name, byKey.get(`${base}-2`).name], names, base);
    assert.ok(!byKey.has(base), base);
  }
  assert.equal(byKey.get('scp-146').name, 'CANON XL 1S CAMCORDER');
  assert.equal(byKey.get('scp-144-146').name, 'BROWN LEATHER GUN HOLSTER');
  assert.deepEqual(byKey.get('scp-108-2').pages, [31, 33]);
  assert.deepEqual(byKey.get('scp-108-2').categories, ['UNIFORMS', 'MENSWEAR']);
  assert.deepEqual(byKey.get('scp-027').pages, [6]);
});

test('multi-number cards keep every printed number', () => {
  const multi = inventory.items.filter((item) => item.itemNumbers?.length > 1).map((item) => item.key).sort();
  assert.deepEqual(multi, ['scp-015-017-016', 'scp-058-060-059', 'scp-062-063', 'scp-144-146']);
});

test('captions keep their own 3-digit numbers and drop size-badge text', () => {
  assert.equal(byKey.get('scp-368').name, 'MONEY MEMORY 274 POCKET CALCULATOR');
  assert.equal(byKey.get('scp-122').name, 'MOTOROLA TELETAC 200 CELLPHONE');
  assert.equal(byKey.get('scp-326').name, 'HTC DESIRE 510 SMARTPHONE');
  assert.equal(byKey.get('scp-119').name, '357 MAGNUM REVOLVER PROP GUN');
  assert.equal(byKey.get('scp-257').name, '357 MAGNUM REVOLVER PROP GUN');
  assert.equal(byKey.get('scp-362').description, 'HEAVY DUTY FIRST RESPONDERS HI-VIS JACKET');
});

test('AI tags belong to real items, are kept separately, and already satisfy the tag rules', () => {
  assert.equal(tagsFile.generator.tool, 'ollama');
  assert.ok(Number.isInteger(tagsFile.generator.promptVersion));
  assert.deepEqual(Object.keys(tagsFile.fingerprints).sort(), Object.keys(tagsFile.tags).sort());
  for (const [key, tags] of Object.entries(tagsFile.tags)) {
    const item = byKey.get(key);
    assert.ok(item, `tags for an unknown item: ${key}`);
    assert.deepEqual(cleanTags(tags, item).tags, tags, key);
    assert.equal(tagsFile.fingerprints[key], tagFingerprint(item), `${key} was tagged from a different name, section or era: run npm run props:tags`);
  }
  for (const item of inventory.items) assert.ok(!('tags' in item), `${item.key} mixes AI tags into vendor facts`);
});

test('reviewed tag removals stay removed', async () => {
  const exclusions = JSON.parse(await readFile(new URL('../scripts/props/tag-exclusions.json', import.meta.url), 'utf8'));
  for (const [key, { drop, reason }] of Object.entries(exclusions)) {
    assert.ok(byKey.has(key), `exclusion for an unknown item: ${key}`);
    assert.ok(reason, key);
    for (const tag of drop) assert.ok(!(tagsFile.tags[key] ?? []).includes(tag), `${key} still has "${tag}"`);
  }
});

test('every acceptable key in the scene fixtures names an indexed item', async () => {
  const directory = new URL('../worker/test/fixtures/scenes/', import.meta.url);
  const { readdir } = await import('node:fs/promises');
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.json'))) {
    const fixture = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
    for (const prop of fixture.required) {
      for (const key of prop.acceptableKeys) assert.ok(byKey.has(key), `${fixture.id} ${prop.prop}: ${key}`);
    }
  }
});
