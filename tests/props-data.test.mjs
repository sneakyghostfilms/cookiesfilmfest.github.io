import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const NAMED_ON_VENDOR_PAGES = new Set([
  '19e0f50bcf2f64571e4cbac622e7b6f4ef0decf6145c95c2c0d176adf4cbd549',
  '289d731509399b68d445a54dc0979679a054e116bd2c480534af66fe2c2a8c22',
  '2d01dd0d4f757baecf59964c3407a6b3220c148cba35406257ffdaa405cfa263',
  '42fe2ba55e1fef4fe3a1b515308ceb697d1f59e8c3f2af1a82726896e7a3ef52',
  '4f9859006b6133f13134d4dceb7f71d00e173799060b31431ec05aebfdfd569d',
  '545f5aaa374f2dfc7812f4f4c69cb7a30bdfd39f42c2240230fc374a0287114a',
  'a3842af3c839ea4cabb100168d3ff307d4de3d144c8ade0664f925c9409c3d60',
  'a6ae07ad556c5f9348cc09c16ed17a437e65acc71e689c1b19f872f1dab3c9c1',
  'a762048a21c020d2bea56f4505e9bceb6a64bdc84d91063ffebf0e29be1a5c97',
  'd64d04ba625edb1fabfcd66fd4144143d734e5cdf9c7720daa6f244643b33289',
]);
const CATALOG_TYPES = new Set(['pdf', 'wordpress-pages', 'duda-gallery', 'shopify-export', 'square-store', 'woocommerce-listing', 'weebly-gallery']);

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
  for (const token of new Set(raw.toLowerCase().split(/[^a-z]+/))) {
    assert.ok(!NAMED_ON_VENDOR_PAGES.has(createHash('sha256').update(token).digest('hex')), `vendors.json names a person: "${token}"`);
  }
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
        const actual = Object.fromEntries(Object.keys(catalog.expected).map((name) => [name, name === 'items' ? items.length : entry[name]]));
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

test('items withheld for naming a private individual stay out of the inventory, each with a generic reason', async () => {
  const { ITEM_EXCLUSION_REASONS } = await import('../scripts/props/import-site.mjs');
  const exclusions = JSON.parse(await readFile(new URL('../scripts/props/item-exclusions.json', import.meta.url), 'utf8'));
  for (const [key, entry] of Object.entries(exclusions)) {
    assert.match(key, /^[a-z0-9]+-[0-9a-z]{6}$/, key);
    assert.ok(!byKey.has(key), `${key} is withheld but in the inventory`);
    assert.deepEqual(Object.keys(entry), ['reason'], key);
    assert.ok(ITEM_EXCLUSION_REASONS.has(entry.reason), `${key}: the reason must be one of the generic reasons, with no name`);
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
