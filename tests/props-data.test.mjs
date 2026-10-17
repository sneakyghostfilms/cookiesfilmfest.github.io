import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkItems } from '../scripts/props/normalize.mjs';
import { cleanTags } from '../scripts/props/tags.mjs';

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
  assert.deepEqual(byKey.get('scp-284').printedIds, ['284']);
});

test('AI tags belong to real items, are kept separately, and already satisfy the tag rules', () => {
  assert.equal(tagsFile.generator.tool, 'ollama');
  assert.ok(Number.isInteger(tagsFile.generator.promptVersion));
  for (const [key, tags] of Object.entries(tagsFile.tags)) {
    const item = byKey.get(key);
    assert.ok(item, `tags for an unknown item: ${key}`);
    assert.deepEqual(cleanTags(tags, item).tags, tags, key);
  }
  for (const item of inventory.items) assert.ok(!('tags' in item), `${item.key} mixes AI tags into vendor facts`);
});
