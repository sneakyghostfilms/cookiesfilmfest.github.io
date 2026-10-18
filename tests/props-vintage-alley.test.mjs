import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { parseCollections } from '../scripts/props/sites/vintage-alley.mjs';

const html = await readFile(new URL('./fixtures/props-vintage-alley.html', import.meta.url), 'utf8');
const vendor = { id: 'vintage-alley', name: 'Vintage Alley Rentals', keyPrefix: 'va' };
const catalog = { id: 'va-test', type: 'duda-gallery', siteUrl: 'https://www.vintagealleypgh.com/', sourceUrl: 'https://www.vintagealleypgh.com/collections' };
const parsed = parseCollections(html, { vendor, catalog });
const byName = new Map(parsed.items.map((item) => [item.name, item]));
const CDN = 'https://irp.cdn-website.com/test/dms3rep/multi/opt/';

test('sections come from the page anchors; each titled photo is an item, and photos sharing a title in a section are one', () => {
  assert.deepEqual(parsed.counts, { sections: 3, photos: 6, items: 5 });
  assert.deepEqual(parsed.items.map((item) => [item.name, item.categories]), [
    ['Test Sofa One', ['Sofas']],
    ['Test Velvet & Cream', ['Sofas']],
    ['Sofas item 1 (no title given)', ['Sofas']],
    ['Side Tables item 1 (no title given)', ['Side Tables']],
    ['Side Tables item 2 (no title given)', ['Side Tables']],
  ]);
  assert.deepEqual(parsed.images.get(byName.get('Test Sofa One').key).urls, [`${CDN}Test_Sofa_One_front-640w.jpg`, `${CDN}Test_Sofa_One_side-640w.jpg`]);
});

test('untitled photos are named honestly, keyed by their image file name, and flagged', () => {
  assert.equal(byName.get('Test Sofa One').key, siteKey('va', 'Sofas|Test Sofa One'));
  assert.equal(byName.get('Side Tables item 1 (no title given)').key, siteKey('va', 'Side Tables|#A.png'));
  assert.equal(byName.get('Side Tables item 2 (no title given)').key, siteKey('va', 'Side Tables|#B+%282%29.png'));
  const flags = parsed.report.slice(parsed.report.findIndex((line) => line.startsWith('Flags:'))).join('\n');
  assert.match(flags, /Lost_Caption\.jpg names caption 999, which is not on the page/);
  assert.match(flags, /B\+%282%29\.png has no published thumbnail URL/);
  assert.match(flags, /section "Coming Soon" has no photo gallery/);
  assert.match(flags, /has no title, named "Sofas item 1 \(no title given\)"/);
});

test('the demo photo is the 640w variant the page publishes, and an item without one has no photo', () => {
  assert.deepEqual(parsed.images.get(byName.get('Side Tables item 1 (no title given)').key).urls, [`${CDN}A-640w.png`]);
  assert.deepEqual(parsed.images.get(byName.get('Side Tables item 2 (no title given)').key).urls, []);
});

test('items keep only names, sections and the page link, and pass the site-item checks', () => {
  for (const item of parsed.items) assert.deepEqual([item.description, item.era, item.decades, item.url], [null, null, [], catalog.sourceUrl], item.name);
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
  assert.throws(() => parseCollections('<html></html>', { vendor, catalog }), /no section anchors/);
});

test('importSite reads the collections page through the fetcher it is given and writes the snapshot', async () => {
  const outFile = path.join(await mkdtemp(path.join(tmpdir(), 'props-va-')), 'inventory.json');
  const requested = [];
  const fetcher = { get: async (url) => (requested.push(url), { body: Buffer.from(html), meta: { url, fetchedAt: '2026-10-17T12:00:00Z' } }) };
  const vendors = { vendors: [{ ...vendor, catalogs: [{ ...catalog, expected: { sections: 3, photos: 6, items: 5 } }] }] };
  const lines = [];
  await importSite({ vendorId: vendor.id, vendors, outFile, fetcher, log: (line) => lines.push(line), today: () => '2026-10-17' });
  assert.deepEqual(requested, [catalog.sourceUrl]);
  const written = JSON.parse(await readFile(outFile, 'utf8'));
  assert.equal(written.items.length, 5);
  assert.deepEqual(written.catalogs['va-test'], { indexedAt: '2026-10-17', capturedAt: '2026-10-17', sections: 3, photos: 6 });
  assert.ok(lines.some((line) => line.includes('Counts match vendors.json "expected".')));
});

test('an item listed in item-exclusions.json is withheld from the snapshot and its photos, and counted', async () => {
  const outFile = path.join(await mkdtemp(path.join(tmpdir(), 'props-va-')), 'inventory.json');
  const fetcher = { get: async (url) => ({ body: Buffer.from(html), meta: { url, fetchedAt: '2026-10-17T12:00:00Z' } }) };
  const withheldKey = byName.get('Test Sofa One').key;
  const exclusions = { [withheldKey]: { reason: "name or photo carries a private individual's name" }, 'va-zzzzzz': { reason: "name or photo carries a private individual's name" }, 'dz-aaaaaa': { reason: "name or photo carries a private individual's name" } };
  const vendors = { vendors: [{ ...vendor, catalogs: [{ ...catalog, expected: { sections: 3, photos: 6, items: 4, withheld: 1 } }] }] };
  const lines = [];
  const { parsed } = await importSite({ vendorId: vendor.id, vendors, outFile, fetcher, exclusions, log: (line) => lines.push(line), today: () => '2026-10-18' });
  assert.deepEqual([parsed.items.length, parsed.items.some((item) => item.key === withheldKey), parsed.images.has(withheldKey)], [4, false, false]);
  const written = JSON.parse(await readFile(outFile, 'utf8'));
  assert.deepEqual([written.items.length, written.catalogs['va-test'].withheld], [4, 1]);
  assert.ok(lines.some((line) => line.includes('Withheld by scripts/props/item-exclusions.json: 1; 1 listed for this vendor are not in this snapshot')), lines.join('\n'));
  assert.ok(lines.some((line) => line.includes('Counts match vendors.json "expected".')));
});
