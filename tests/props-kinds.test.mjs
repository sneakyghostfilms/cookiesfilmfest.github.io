import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { KINDS, KIND_LABELS, kindOf } from '../src/scripts/props-kinds.js';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const kinds = await read('../src/data/props/kinds.json');
const { vendors } = await read('../src/data/props/vendors.json');
const inventory = await read('../src/data/props/inventory.json');
const KIND_OF_SOURCE_TYPE = { 'prop-house': 'film-prop', 'theater-stock': 'film-prop', 'vintage-rental': 'set-dressing', 'event-rental': 'event-rental', 'antique-reuse': 'antique' };

test('kinds.json gives every vendor with a catalog one of the four kinds, matching its source type, with a written source', () => {
  const withCatalogs = vendors.filter((vendor) => vendor.catalogs?.length).map((vendor) => vendor.id);
  assert.deepEqual(Object.keys(kinds.vendors).sort(), [...withCatalogs].sort());
  for (const [id, entry] of Object.entries(kinds.vendors)) {
    const vendor = vendors.find((one) => one.id === id);
    assert.equal(entry.kind, KIND_OF_SOURCE_TYPE[vendor.sourceType.value], id);
    assert.ok(typeof entry.source === 'string' && entry.source.trim().length > 10, `${id}: the source is written out`);
  }
});

test("each category override names a category the vendor's items really have, with its own kind and source", () => {
  for (const [id, entry] of Object.entries(kinds.vendors)) {
    const categories = new Set(inventory.items.filter((item) => item.vendor === id).flatMap((item) => item.categories));
    for (const [category, override] of Object.entries(entry.categories ?? {})) {
      assert.ok(categories.has(category), `${id}: ${category}`);
      assert.ok(Object.hasOwn(KIND_LABELS, override.kind), `${id}: ${category}`);
      assert.ok(typeof override.source === 'string' && override.source.trim().length > 10, `${id}: ${category} has a source`);
    }
  }
});

test("an item's kind is its first overridden category's kind, else its vendor's", () => {
  const file = { vendors: { v: { kind: 'event-rental', categories: { Phones: { kind: 'set-dressing' }, Booths: { kind: 'film-prop' } } } } };
  assert.equal(kindOf({ vendor: 'v', categories: ['Cards'] }, file), 'event-rental');
  assert.equal(kindOf({ vendor: 'v', categories: ['Cards', 'Phones', 'Booths'] }, file), 'set-dressing');
  assert.equal(kindOf({ vendor: 'v', categories: ['Booths', 'Phones'] }, file), 'film-prop');
  assert.throws(() => kindOf({ vendor: 'new-vendor', categories: [] }, file), /kinds\.json has no entry for new-vendor/);
  for (const item of inventory.items) assert.ok(Object.hasOwn(KIND_LABELS, kindOf(item, kinds)), item.key);
});

test('the four kinds have their labels, in the order the page lists them', () => {
  assert.deepEqual(KINDS.map(({ label }) => label), ['Film prop', 'Set dressing', 'Event rental', 'Antiques and reuse']);
});
