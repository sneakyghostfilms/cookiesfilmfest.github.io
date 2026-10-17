import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkItems } from '../scripts/props/normalize.mjs';
import { cleanTags, tagFingerprint } from '../scripts/props/tags.mjs';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const vendors = await read('../src/data/props/vendors.json');
const inventory = await read('../src/data/props/inventory.json');
const tagsFile = await read('../src/data/props/tags.json');
const byKey = new Map(inventory.items.map((item) => [item.key, item]));

test('each catalog passes the import invariants and matches its expected counts', () => {
  for (const vendor of vendors.vendors) {
    for (const catalog of vendor.catalogs) {
      const entry = inventory.catalogs[catalog.id];
      assert.ok(entry, `inventory has no entry for ${catalog.id}`);
      const items = inventory.items.filter((item) => item.catalog === catalog.id);
      const sectionTitles = entry.sections.map((section) => section.title);
      assert.deepEqual(checkItems(items, { pageCount: catalog.pageCount, sectionTitles }), []);
      assert.deepEqual({ cards: entry.cards, items: items.length, itemPages: entry.itemPages.length }, catalog.expected);
      assert.deepEqual([...new Set(items.flatMap((item) => item.pages))].sort((a, b) => a - b), entry.itemPages);
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
  const multi = inventory.items.filter((item) => item.itemNumbers.length > 1).map((item) => item.key).sort();
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
