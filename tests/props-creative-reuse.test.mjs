import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { parseStore, storeCategoryName, storeListPage, storePageCount } from '../scripts/props/sites/creative-reuse.mjs';

const vendor = { id: 'reuse-test', name: 'Test Reuse Store', keyPrefix: 'rt' };
const catalog = {
  id: 'rt-test',
  type: 'square-store',
  sourceUrl: 'https://store.example/shop/oddities/7',
  listUrl: 'https://store.example/app/store/api/v28/editor/users/1/sites/2/products?categories[]=7&per_page=100',
  siteUrl: 'https://store.example/',
  photoHost: 'img.example',
};
const categoryPage = '<html><head>\n<script>\n        window.__BOOTSTRAP_STATE__ = {"commerceLinks":{"categories":{"7":{"name":"Test Oddities"},"8":{"name":"Other"}}}};\n</script>\n</head><body><div id="app"></div></body></html>';

function product(id, overrides = {}) {
  const { inventory, badges, price, ...rest } = overrides;
  return {
    id,
    name: `Test thing ${id}`,
    absolute_site_link: `https://store.example/product/test-thing/${id}`,
    categoryIds: ['7', 'STORE'],
    visibility: 'visible',
    product_type: 'physical',
    badges: { out_of_stock: false, ...badges },
    inventory: { total: 1, all_variations_sold_out: false, marked_sold_out_at_all_existing_locations: false, has_location_not_tracking: false, enabled: false, ...inventory },
    price: { low_subunits: 1999, high_subunits: 1999, ...price },
    thumbnail: { data: { absolute_urls: { 640: `https://img.example/uploads/${id}.jpeg?width=640`, 320: `https://img.example/uploads/${id}.jpeg?width=320` } } },
    ...rest,
  };
}
const listing = (data, page, pages, total) => ({ data, meta: { pagination: { total, count: data.length, per_page: 100, current_page: page, total_pages: pages, links: { next: page < pages ? `https://store.example/app/store/api/v28/editor/users/1/sites/2/products?page=${page + 1}` : undefined } } } });

test('in-stock products of the category become items with the store name, link, price and 640 px photo; stock values are never stored', () => {
  const parsed = parseStore(categoryPage, [listing([product('A1', { name: 'Test radio, 1950s', price: { low_subunits: 19599, high_subunits: 19599 } }), product('B2', { price: { low_subunits: 500, high_subunits: 900 } })], 1, 1, 2)], { vendor, catalog });
  assert.deepEqual(parsed.items, [
    { key: siteKey('rt', 'A1'), vendor: 'reuse-test', catalog: 'rt-test', name: 'Test radio, 1950s', description: null, categories: ['Test Oddities'], era: '1950s', decades: [1950], url: 'https://store.example/product/test-thing/A1', listedPrice: '195.99' },
    { key: siteKey('rt', 'B2'), vendor: 'reuse-test', catalog: 'rt-test', name: 'Test thing B2', description: null, categories: ['Test Oddities'], era: null, decades: [], url: 'https://store.example/product/test-thing/B2', listedPrice: '5.00' },
  ]);
  assert.deepEqual(parsed.images.get(siteKey('rt', 'A1')).urls, ['https://img.example/uploads/A1.jpeg?width=640']);
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
  assert.match(parsed.report.join('\n'), /with a price range, the lowest kept: 1/);
});

test("stock: the store's sold-out badge or flags exclude a product, and so does a stock count of 0 unless that stock is untracked", () => {
  const products = [
    product('KEEP'),
    product('BADGE', { badges: { out_of_stock: true } }),
    product('ALLGONE', { inventory: { all_variations_sold_out: true } }),
    product('MARKED', { inventory: { marked_sold_out_at_all_existing_locations: true } }),
    product('ZERO', { inventory: { total: 0 } }),
    product('UNTRACKED', { inventory: { total: 0, has_location_not_tracking: true } }),
    product('UNTRACKEDSOLD', { badges: { out_of_stock: true }, inventory: { total: 0, has_location_not_tracking: true } }),
  ];
  const parsed = parseStore(categoryPage, [listing(products, 1, 1, products.length)], { vendor, catalog });
  assert.deepEqual(parsed.items.map((item) => item.name), ['Test thing KEEP', 'Test thing UNTRACKED']);
  assert.equal(parsed.counts.excluded['sold out'], 5);
  const report = parsed.report.join('\n');
  assert.match(report, /by the store's badge or flags: 4; by a tracked stock count of 0 alone: 1\. Kept with untracked stock: 1 \(stock count 0: 1\)/);
  for (const item of parsed.items) assert.ok(!('inventory' in item) && !('total' in item), 'no stock value is stored');
});

test('products outside the category, hidden, not physical or listed twice are excluded and counted', () => {
  const parsed = parseStore(categoryPage, [
    listing([product('A'), product('OTHER', { categoryIds: ['8'] }), product('HIDDEN', { visibility: 'hidden' }), product('GIFT', { product_type: 'digital' })], 1, 2, 6),
    listing([product('A'), product('B')], 2, 2, 6),
  ], { vendor, catalog });
  assert.deepEqual(parsed.items.map((item) => item.name), ['Test thing A', 'Test thing B']);
  assert.deepEqual(parsed.counts, { products: 5, items: 2, excluded: { 'not in the category': 1, 'not visible': 1, 'not physical': 1, 'sold out': 0, 'listed twice': 1 } });
});

test('a photo off the photo host or no photo is reported, and a product with no price stores none', () => {
  const offHost = product('OFF', { thumbnail: { data: { absolute_urls: { 640: 'https://elsewhere.example/x.jpeg?width=640' } } } });
  const noPhoto = product('NOPHOTO', { thumbnail: null });
  const noPrice = product('NOPRICE', { price: { low_subunits: null, high_subunits: null } });
  const parsed = parseStore(categoryPage, [listing([offHost, noPhoto, noPrice], 1, 1, 3)], { vendor, catalog });
  const report = parsed.report.join('\n');
  assert.match(report, /not on img\.example, which stops the demo's photo download: 1; items with no photo: 1/);
  assert.match(report, /with no price: 1/);
  assert.ok(!('listedPrice' in parsed.items[2]));
  assert.deepEqual(parsed.images.get(parsed.items[1].key).urls, []);
});

test('the pages must agree on their numbering and total, and the category page must name the category', () => {
  assert.throws(() => parseStore(categoryPage, [listing([product('A')], 2, 1, 1)], { vendor, catalog }), /says it is page 2 of 1/);
  assert.throws(() => parseStore(categoryPage, [listing([product('A')], 1, 2, 2), listing([product('B')], 2, 3, 2)], { vendor, catalog }), /don't agree/);
  assert.throws(() => storeCategoryName(categoryPage, '99'), /names no category 99/);
  assert.throws(() => storeCategoryName('<html></html>', '7'), /names no category 7/);
  assert.equal(storeCategoryName(categoryPage, '7'), 'Test Oddities');
  for (const pages of [0, 21, 1.5, '2', undefined]) assert.throws(() => storePageCount({ meta: { pagination: { total_pages: pages } } }), /total_pages/, String(pages));
  assert.equal(storePageCount({ meta: { pagination: { total_pages: 2 } } }), 2);
});

test("importSite reads robots.txt, the category page and each list page built from the first page's query, never the store's own next link", async () => {
  const outFile = path.join(await mkdtemp(path.join(tmpdir(), 'props-rt-')), 'inventory.json');
  const pages = {
    'https://store.example/robots.txt': 'User-agent: *\nDisallow: /product/*/*/leave-review\nCrawl-delay: 5\n',
    [catalog.sourceUrl]: categoryPage,
    [storeListPage(catalog, 1)]: JSON.stringify(listing([product('A'), product('SOLD', { badges: { out_of_stock: true } })], 1, 2, 3)),
    [storeListPage(catalog, 2)]: JSON.stringify(listing([product('B')], 2, 2, 3)),
  };
  const requested = [];
  const gaps = [];
  const fetcher = {
    get: async (url) => {
      requested.push(url);
      if (!(url in pages)) throw new Error(`unexpected request ${url}`);
      return { body: Buffer.from(pages[url]), meta: { url, fetchedAt: '2026-10-18T12:00:00Z' }, missing: false };
    },
    raiseGap: (ms) => gaps.push(ms),
  };
  const vendors = { vendors: [{ ...vendor, catalogs: [{ ...catalog, expected: { products: 3, items: 2, excluded: { 'not in the category': 0, 'not visible': 0, 'not physical': 0, 'sold out': 1, 'listed twice': 0 } } }] }] };
  const lines = [];
  await importSite({ vendorId: vendor.id, vendors, outFile, fetcher, exclusions: {}, log: (line) => lines.push(line), today: () => '2026-10-18' });
  assert.deepEqual(requested, ['https://store.example/robots.txt', catalog.sourceUrl, `${catalog.listUrl}&page=1`, `${catalog.listUrl}&page=2`]);
  assert.deepEqual(gaps, [5000]);
  const written = JSON.parse(await readFile(outFile, 'utf8'));
  assert.equal(written.items.length, 2);
  assert.deepEqual(written.catalogs['rt-test'], { indexedAt: '2026-10-18', capturedAt: '2026-10-18', products: 3, excluded: { 'not in the category': 0, 'not visible': 0, 'not physical': 0, 'sold out': 1, 'listed twice': 0 } });
  assert.ok(lines.some((line) => line.includes('Counts match vendors.json "expected".')), lines.join('\n'));
  assert.ok(written.items.every((item) => /^\d+\.\d{2}$/.test(item.listedPrice)));
});
