import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { decadesOf, eraDecades } from '../scripts/props/normalize.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { isDescriptive, parsePages, splitAltEra } from '../scripts/props/sites/dezzign-central.mjs';

const read = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
const pages = await read('./fixtures/props-dezzign-pages.json');
const inventory = await read('../src/data/props/inventory.json');
const vendor = { id: 'dezzign-central', name: 'Dezzign Central', keyPrefix: 'dz' };
const catalog = { id: 'dz-test', type: 'wordpress-pages', siteUrl: 'https://dezzigncentralpgh.com/props/', sourceUrl: 'https://dezzigncentralpgh.com/wp-json/wp/v2/pages?parent=76&per_page=100' };
const parsed = parsePages(pages, { vendor, catalog });
const byName = new Map(parsed.items.map((item) => [item.name, item]));

test('site keys are short, stable hashes of a stable input', () => {
  assert.equal(siteKey('dz', 'chairs|yellow chair'), 'dz-1nfqu2');
  assert.equal(siteKey('ro8', 'test-typewriter'), 'ro8-23kj0f');
  assert.match(siteKey('dz', ''), /^dz-[0-9a-z]{6}$/);
  assert.ok(Math.max(...parsed.items.map((item) => item.key.length)) <= 16, 'keys fit the Worker output cap');
});

test('era decades read whole ranges, whatever the dash or apostrophe', () => {
  assert.deepEqual(eraDecades('1950s-70s'), [1950, 1960, 1970]);
  assert.deepEqual(eraDecades('1950s–70s'), [1950, 1960, 1970]);
  assert.deepEqual(eraDecades('1950s—70s'), [1950, 1960, 1970]);
  assert.deepEqual(eraDecades("60's/70's"), [1960, 1970]);
  assert.deepEqual(eraDecades('era 1950'), [1950]);
  assert.deepEqual(eraDecades(null), []);
  for (const { era } of inventory.items) assert.deepEqual(eraDecades(era), decadesOf(era), `catalog era ${era} reads the same`);
});

test('pages are read in the vendor menu order, with categories as published', () => {
  assert.deepEqual([...new Set(parsed.items.map((item) => item.categories[0]))], ['signs', 'lamps', 'iceboxes & coolers']);
  assert.deepEqual(parsed.counts, { pages: 3, photos: 10, items: 9 });
});

test('photos with the same title are one item; untitled photos are named honestly and flagged', () => {
  assert.deepEqual(parsed.images.get(byName.get('green desk lamp').key).urls, [
    'https://dezzigncentralpgh.com/wp-content/uploads/2015/02/lamp-green-01.jpg',
    'https://dezzigncentralpgh.com/wp-content/uploads/2015/02/lamp-green-02.jpg',
  ]);
  assert.ok(byName.has('lamps item 1 (no title given)'));
  assert.ok(byName.has('lamps item 2 (no title given)'), 'a filename is not a title');
  assert.ok(byName.has('lamps item 3 (no title given)'), 'two photos without titles are never merged into one object');
  assert.notEqual(byName.get('lamps item 1 (no title given)').key, byName.get('lamps item 3 (no title given)').key);
  assert.ok(!byName.has('lamp with no file'), 'a photo without a src is skipped');
  const flags = parsed.report.join('\n');
  assert.match(flags, /"green desk lamp side view" may be another view of "green desk lamp"/);
  assert.match(flags, /"lamps" only repeats its category/);
  assert.match(flags, /has no usable photo title \(alt "IMG_2041.jpg"\)/);
  assert.match(flags, /props\/lamps\/ photo 8 has no src and was skipped/);
  assert.match(flags, new RegExp(`${byName.get('green desk lamp').key} · green desk lamp · lamps · no era · 2`));
  assert.match(flags, new RegExp(`${byName.get('oak icebox').key} · oak icebox · iceboxes & coolers · era 1920 · 1`));
  assert.equal(isDescriptive('IMG_2041.jpg'), false);
  assert.equal(isDescriptive('DSC 0042'), false);
  assert.equal(isDescriptive('photo'), false);
  assert.equal(isDescriptive('   '), false);
  assert.equal(isDescriptive('boat'), true);
});

test('an era comes only from the vendor words "- era YYYY", never from file names', () => {
  assert.deepEqual(splitAltEra('stainless steel refrigerator - era 1950'), { name: 'stainless steel refrigerator', era: 'era 1950' });
  assert.deepEqual(splitAltEra('1950 refrigerator'), { name: '1950 refrigerator', era: null });
  const icebox = byName.get('oak icebox');
  assert.deepEqual([icebox.era, icebox.decades], ['era 1920', [1920]]);
  const cooler = byName.get('steel cooler');
  assert.deepEqual([cooler.era, cooler.decades], [null, []], 'its file is named 1955-steel-cooler-01.jpg');
});

test('items keep only text facts: no description, the category page as the source link', () => {
  for (const item of parsed.items) {
    assert.equal(item.description, null);
    assert.ok(item.url.startsWith('https://dezzigncentralpgh.com/props/'));
  }
  assert.equal(byName.get('neon diner sign – red').url, 'https://dezzigncentralpgh.com/props/signs/');
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
});

test('checkSiteItems reports each kind of broken website item', () => {
  const good = parsed.items[0];
  const broken = (change) => checkSiteItems([{ ...structuredClone(good), ...change }], { vendor, catalog }).join();
  assert.match(broken({ key: 'dz-TOOLONG1' }), /malformed/);
  assert.match(broken({ name: 'lamp | brass' }), /would break a listing line/);
  assert.match(broken({ name: 'lamp\nbrass' }), /control character or line break/);
  assert.match(broken({ categories: 'chairs' }), /categories is not a list/);
  assert.match(broken({ categories: ['chairs | stools'] }), /category holds " \| "/);
  assert.match(broken({ era: '1950s', decades: [] }), /decades/);
  assert.match(broken({ description: 'a vendor sentence' }), /no description/);
  assert.match(broken({ url: 'https://elsewhere.example/x' }), /not under/);
  assert.match(broken({ listedPrice: '12.00' }), /unexpected fields listedPrice/);
  assert.match(broken({ cost: '3.00' }), /unexpected fields cost/);
  assert.match(checkSiteItems([good, good], { vendor, catalog }).join(), /duplicate key/);
});

test('the parser refuses pages outside the props section and empty answers', () => {
  assert.throws(() => parsePages([], { vendor, catalog }), /no pages/);
  const stray = [{ ...pages[0], link: 'https://dezzigncentralpgh.com/clients/rumfish/' }];
  assert.throws(() => parsePages(stray, { vendor, catalog }), /not under/);
});

test('importSite writes the snapshot through the shared inventory writer and reports the counts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'props-site-'));
  const outFile = path.join(directory, 'inventory.json');
  const vendors = { vendors: [{ ...vendor, catalogs: [{ ...catalog, expected: { pages: 3, photos: 10, items: 7 } }] }] };
  const fetcher = { get: async (url) => ({ body: Buffer.from(JSON.stringify(pages)), meta: { url, fetchedAt: '2026-10-17T16:00:00.000Z' } }) };
  const lines = [];
  await importSite({ vendorId: vendor.id, vendors, outFile, fetcher, log: (line) => lines.push(line), today: () => '2026-10-17' });
  const written = JSON.parse(await readFile(outFile, 'utf8'));
  assert.deepEqual(written.catalogs['dz-test'], { indexedAt: '2026-10-17', capturedAt: '2026-10-17', pages: 3, photos: 10 });
  assert.deepEqual(written.items, parsed.items);
  assert.match(lines.join('\n'), /items 9 \(expected 7\)/);
  await importSite({ vendorId: vendor.id, vendors, outFile, fetcher, log: () => {}, today: () => '2026-10-18' });
  assert.equal(JSON.parse(await readFile(outFile, 'utf8')).catalogs['dz-test'].indexedAt, '2026-10-17', 'an unchanged snapshot keeps its date');
  await assert.rejects(importSite({ vendorId: 'nobody', vendors, outFile, fetcher }), /No vendor "nobody"/);
  const tenPages = { vendors: [{ ...vendor, catalogs: [{ ...catalog, sourceUrl: 'https://dezzigncentralpgh.com/wp-json/wp/v2/pages?parent=76' }] }] };
  const fullPage = { get: async (url) => ({ body: Buffer.from(JSON.stringify(Array(10).fill(pages[0]))), meta: { url, fetchedAt: '2026-10-17T16:00:00.000Z' } }) };
  await assert.rejects(importSite({ vendorId: vendor.id, vendors: tenPages, outFile, fetcher: fullPage, log: () => {} }), /full page of 10/);
});
