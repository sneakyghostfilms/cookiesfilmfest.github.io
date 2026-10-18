import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { categoryName, categoryNames, nextListingPage, parseListing } from '../scripts/props/sites/construction-junction.mjs';

const vendor = { id: 'listing-test', name: 'Test Listing Store', keyPrefix: 'lt' };
const catalog = { id: 'lt-test', type: 'woocommerce-listing', sourceUrl: 'https://shop.example/shop/', siteUrl: 'https://shop.example/' };
const amount = (value) => `<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol" translate="no">&#36;</span>${value}</bdi></span>`;
const upload = (name) => `https://shop.example/wp-content/uploads/2026/10/${name}`;

function card({ post, stock = 'instock', cats = ['online', 'lamps'], title = `Test Lamp &#8211; Model ${post}`, href = `https://shop.example/shop/test-lamp-${post}/`, price = amount('12.99'), widths = [300, 150, 60, 320, 10, 480] }) {
  const srcset = widths ? ` data-srcset="${widths.map((width) => `${upload(`p${post}-${width}.jpg`)} ${width}w`).join(', ')}"` : '';
  return `<div class="col-md-4 product type-product post-${post} status-publish ${stock} ${cats.map((slug) => `product_cat-${slug}`).join(' ')} has-post-thumbnail">
  <div class="content-product"><div class="product-image-wrapper"><p class="stock in-stock">1 in stock</p>
  <a class="product-content-image" href="${href}"><img width="300" height="225" src="https://shop.example/placeholder.png" data-src="${upload(`p${post}-300x225.jpg`)}"${srcset} /></a></div>
  <div class="text-center product-details"><h2 class="product-title">
    <a href="${href}">${title}</a>
  </h2>
  <span class="price">${price}</span>
  <span class="stock-qty-onhand">1 in stock</span></div></div></div>`;
}

const NAMED = [['lighting', 'Lighting -'], ['lighting/lamps', 'Lamps -'], ['in-store', 'In-store'], ['online', 'Online'], ['ship', 'Ship'], ['pipe', 'Pipe'], ['building-material-and-lumber/roofing', 'Roofing'], ['building-material-and-lumber/roofing/roof-tile', 'Roof Tile']];
function page(cards, { number = 1, last = false, next, rel } = {}) {
  const nextUrl = next !== undefined ? next : last ? null : `https://shop.example/shop/page/${number + 1}/`;
  const relUrl = rel !== undefined ? rel : nextUrl;
  return `<html><head>${relUrl ? `<link rel="next" href="${relUrl}" />` : ''}</head><body>
<nav class="menu"><a href="/product-category/tile-and-accessories/">Tile</a> <a href="/product-category/lighting/">Lights</a></nav>
<div class="products">${cards.join('\n')}</div>
<nav class="woocommerce-pagination"><ul class="page-numbers">${nextUrl ? `<li><a class="next page-numbers" href="${nextUrl}"><span>next</span></a></li>` : ''}</ul></nav>
<div id="woocommerce_product_categories-2" class="sidebar-widget woocommerce widget_product_categories"><ul class="product-categories">${NAMED.map(([where, name]) => `<li class="cat-item"><a href="https://shop.example/product-category/${where}/">${name}</a></li>`).join('\n')}</ul></div><!-- //sidebar-widget -->
<div class="wcpf-filter"><ul><li class="wcpf-item" data-value="vintage-material-inventory">
  <div class="wcpf-item-inner wcpf-checkbox-item">
    <button type="button" class="wcpf-button">
      <div class="wcpf-title-container"><span class="wcpf-title">Vintage</span></div></button></div></li></ul></div>
</body></html>`;
}
const parse = (...pages) => parseListing(pages, { vendor, catalog });

test('in-stock cards become items with the visible title, category names, link, price and 320 px photo', () => {
  const parsed = parse(page([card({ post: 101, title: 'Test Lamp &#8211;   Brass Desk, 1950s' }), card({ post: 102, stock: 'outofstock' }), card({ post: 103, stock: 'onbackorder' })], { last: true }));
  const key = siteKey('lt', '101');
  assert.deepEqual(parsed.items, [{
    key,
    vendor: 'listing-test',
    catalog: 'lt-test',
    name: 'Test Lamp – Brass Desk, 1950s',
    description: null,
    categories: ['Lamps'],
    era: '1950s',
    decades: [1950],
    url: 'https://shop.example/shop/test-lamp-101/',
    listedPrice: '12.99',
  }]);
  assert.deepEqual(parsed.counts, { pages: 1, cards: 3, items: 1, excluded: { 'not in stock': 2, 'building material': 0, repeated: 0 } });
  assert.deepEqual(parsed.images.get(key), { urls: [upload('p101-320.jpg')] });
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
  assert.throws(() => parse(page([card({ post: 104, href: 'https://shop.example/elsewhere/lamp/' })], { last: true })), /post 104 on page 1 links to https:\/\/shop\.example\/elsewhere\/lamp\/, outside/i);
  assert.throws(() => parse(page([card({ post: 105 }).replace('post-105', 'status-draft')], { last: true })), /no post id or no title link/);
});

test('category names: the trailing " -" is stripped, fulfillment categories are left out, the widget beats the menu, and an unnamed slug is flagged', () => {
  for (const [shown, name] of [['Chair -', 'Chair'], ['Dimensional Lumber -  ', 'Dimensional Lumber'], ['Hand-made -', 'Hand-made'], ['Lighting &amp; Fans', 'Lighting & Fans'], ['Re-Use', 'Re-Use']]) assert.equal(categoryName(shown), name, shown);
  const names = categoryNames(page([]), catalog.siteUrl);
  assert.deepEqual(['lighting', 'lamps', 'tile-and-accessories', 'vintage-material-inventory'].map((slug) => names.get(slug)), ['Lighting', 'Lamps', 'Tile', 'Vintage']);
  const parsed = parse(page([card({ post: 201, cats: ['in-store', 'online', 'ship', 'lamps', 'mystery-slug'] })], { last: true }));
  assert.deepEqual(parsed.items[0].categories, ['Lamps']);
  assert.ok(parsed.report.includes('Categories named on the pages: 10. Category slugs on cards that no page names, left out of the item\'s categories: mystery-slug 1'), parsed.report.join('\n'));
});

test('building materials: a card is left out only when every category it has is one, and each is counted and listed', () => {
  const parsed = parse(page([
    card({ post: 301, cats: ['online', 'roof-tile'] }),
    card({ post: 302, cats: ['in-store', 'pipe', 'roofing'] }),
    card({ post: 303, cats: ['online', 'pipe', 'lamps'] }),
    card({ post: 304, cats: ['online', 'roof-tile', 'vintage-material-inventory'] }),
    card({ post: 305, cats: ['online'] }),
  ], { last: true }));
  assert.equal(parsed.counts.excluded['building material'], 2);
  assert.deepEqual(parsed.items.map((item) => [item.key, item.categories]), [[siteKey('lt', '303'), ['Pipe', 'Lamps']], [siteKey('lt', '304'), ['Roof Tile', 'Vintage']], [siteKey('lt', '305'), []]]);
  const report = parsed.report.join('\n');
  assert.match(report, /per category \(a card counts under each of its building-material categories\): Roof Tile \(roof-tile\) 1, Pipe \(pipe\) 1, Roofing \(roofing\) 1/);
  assert.match(report, /post 301 · Test Lamp – Model 301 · Roof Tile\n {2}post 302 · Test Lamp – Model 302 · Pipe, Roofing/);
  assert.match(report, /post 305 \("Test Lamp – Model 305"\) has no category besides how it is sold/);
});

test('prices: a sale keeps the current price, a range keeps none, and "$" and "," are dropped', () => {
  const sale = `<del aria-hidden="true">${amount('20.00')}</del> <span class="screen-reader-text">Original price was: &#36;20.00.</span><ins aria-hidden="true">${amount('15.50')}</ins>`;
  const parsed = parse(page([
    card({ post: 401, price: sale }),
    card({ post: 402, price: `${amount('5.00')} &ndash; ${amount('9.00')}` }),
    card({ post: 403, price: amount('1,995.99') }),
    card({ post: 404, price: '' }),
  ], { last: true }));
  assert.deepEqual(parsed.items.map((item) => item.listedPrice), ['15.50', undefined, '1995.99', undefined]);
  assert.ok(parsed.report.includes('Prices kept as listedPrice (never shown): 2, of which sale prices (the current price kept): 1; price ranges, no price kept: 1; no price: 1'), parsed.report.join('\n'));
});

test('photos: the smallest variant at least 320 px wide, or else the widest, and the report counts each choice', () => {
  const parsed = parse(page([
    card({ post: 501 }),
    card({ post: 502, widths: [300, 1024, 150, 768, 480] }),
    card({ post: 503, widths: [300, 150] }),
    card({ post: 504, widths: null }),
  ], { last: true }));
  assert.deepEqual(parsed.items.map((item) => parsed.images.get(item.key).urls[0]), [upload('p501-320.jpg'), upload('p502-480.jpg'), upload('p503-300.jpg'), upload('p504-300x225.jpg')]);
  assert.ok(parsed.report.includes('Photo variant used: 320w 1, 480w 1, 300w, narrower than 320 1, data-src only 1'), parsed.report.join('\n'));
});

test('the walk follows rel="next" when it is the next page and the visible link is the same page without its query; anything else stops it', () => {
  const clean = 'https://shop.example/shop/page/2/';
  assert.equal(nextListingPage(page([]), catalog.sourceUrl, 1), clean);
  assert.equal(nextListingPage(page([], { number: 28 }), catalog.sourceUrl, 28), 'https://shop.example/shop/page/29/');
  assert.equal(nextListingPage(page([], { last: true }), catalog.sourceUrl, 29), null);
  assert.equal(nextListingPage(page([], { next: `${clean}?_kx=made-up-value`, rel: clean }), catalog.sourceUrl, 1), clean, 'a query on the visible link only is dropped');
  const twoVisible = page([]).replace('</ul></nav>', `<li><a class="next page-numbers" href="${clean}">next</a></li></ul></nav>`);
  const stops = [
    [page([], { next: 'https://shop.example/shop/page/3/' }), /rel="next" is https:\/\/shop\.example\/shop\/page\/3\/, not https:\/\/shop\.example\/shop\/page\/2\//],
    [page([], { next: `${clean}?_kx=made-up-value` }), /rel="next" is https:\/\/shop\.example\/shop\/page\/2\/\?_kx=…, not/],
    [page([], { next: 'https://shop.example/shop/page/3/', rel: clean }), /next link is https:\/\/shop\.example\/shop\/page\/3\/, not/],
    [page([], { next: 'https://shop.example/shop/page/3/?_kx=made-up-value', rel: clean }), /next link is https:\/\/shop\.example\/shop\/page\/3\/\?_kx=…, not/],
    [page([], { next: 'https://other.example/shop/page/2/', rel: clean }), /next link is https:\/\/other\.example\/shop\/page\/2\/, not/],
    [page([], { next: '/shop/page/2/', rel: clean }), /next link is \/shop\/page\/2\/, not/],
    [page([], { rel: null }), /next links disagree \(visible \[https:\/\/shop\.example\/shop\/page\/2\/\], rel="next" \[\]\)/],
    [page([], { next: null, rel: clean }), /next links disagree/],
    [page([], { next: `${clean}?_kx=made-up-value`, rel: null }), /next links disagree \(visible \[https:\/\/shop\.example\/shop\/page\/2\/\?_kx=…\], rel="next" \[\]\)/],
    [twoVisible, /next links disagree/],
  ];
  for (const [html, message] of stops) {
    assert.throws(() => nextListingPage(html, catalog.sourceUrl, 1), (error) => message.test(error.message) && !error.message.includes('made-up-value'), String(message));
  }
});

test('a product link or photo URL with a query stops the parse, naming only the parameter, and a pager query is reported by name', () => {
  assert.throws(() => parse(page([card({ post: 106, href: 'https://shop.example/shop/test-lamp-106/?_kx=made-up-value' })], { last: true })), (error) => /Post 106 on page 1 links to its product with a query \(_kx\)/.test(error.message) && !error.message.includes('made-up-value'));
  const tracked = card({ post: 107 }).replaceAll('.jpg ', '.jpg?utm_source=made-up-value ');
  assert.throws(() => parse(page([tracked], { last: true })), (error) => /Post 107 on page 1 has a photo URL with a query \(utm_source\)/.test(error.message) && !error.message.includes('made-up-value'));
  const parsed = parse(page([card({ post: 108 })], { next: 'https://shop.example/shop/page/2/?_kx=made-up-value', rel: 'https://shop.example/shop/page/2/' }));
  assert.ok(parsed.report.includes("  page 1's pager links carry a query (_kx), which is never sent"), parsed.report.join('\n'));
  assert.ok(!parsed.report.join('\n').includes('made-up-value'));
});

test('a post already seen on an earlier page is kept once and flagged as listing drift', () => {
  const parsed = parse(page([card({ post: 601 }), card({ post: 602 })]), page([card({ post: 602 }), card({ post: 603 })], { number: 2, last: true }));
  assert.deepEqual(parsed.items.map((item) => item.key), ['601', '602', '603'].map((post) => siteKey('lt', post)));
  assert.deepEqual(parsed.counts, { pages: 2, cards: 4, items: 3, excluded: { 'not in stock': 0, 'building material': 0, repeated: 1 } });
  assert.ok(parsed.report.includes('  listing drift: post 602 ("Test Lamp – Model 602") is on page 1 and again on page 2; kept once'), parsed.report.join('\n'));
});

function stubFetcher(pages) {
  const requested = [];
  const gaps = [];
  return {
    requested,
    gaps,
    get: async (url) => {
      requested.push(url);
      const body = typeof pages === 'function' ? pages(url) : pages[url];
      if (body === undefined) throw new Error(`unexpected request ${url}`);
      return { body: Buffer.from(body), meta: { url, fetchedAt: '2026-10-18T12:00:00Z' }, missing: false };
    },
    raiseGap: (ms) => gaps.push(ms),
  };
}

test('importSite reads robots.txt, then the first page, then each next page, and writes the items', async () => {
  const outFile = path.join(await mkdtemp(path.join(tmpdir(), 'props-lt-')), 'inventory.json');
  const fetcher = stubFetcher({
    'https://shop.example/robots.txt': 'User-agent: *\nDisallow: /*?add-to-cart=\nDisallow: /page/*/?s=\nCrawl-delay: 3\n',
    'https://shop.example/shop/': page([card({ post: 701 }), card({ post: 702, cats: ['online', 'pipe'] })], { next: 'https://shop.example/shop/page/2/?_kx=made-up-value', rel: 'https://shop.example/shop/page/2/' }),
    'https://shop.example/shop/page/2/': page([card({ post: 703, stock: 'outofstock' }), card({ post: 704 })], { number: 2, last: true }),
  });
  const expected = { pages: 2, cards: 4, items: 2, excluded: { 'not in stock': 1, 'building material': 1, repeated: 0 } };
  const vendors = { vendors: [{ ...vendor, catalogs: [{ ...catalog, expected }] }] };
  const lines = [];
  await importSite({ vendorId: vendor.id, vendors, outFile, fetcher, exclusions: {}, log: (line) => lines.push(line), today: () => '2026-10-18' });
  assert.deepEqual(fetcher.requested, ['https://shop.example/robots.txt', 'https://shop.example/shop/', 'https://shop.example/shop/page/2/'], 'the query on page 1\'s visible next link is never sent');
  assert.deepEqual(fetcher.gaps, [3000]);
  const written = JSON.parse(await readFile(outFile, 'utf8'));
  assert.deepEqual(written.items.map((item) => item.key), ['701', '704'].map((post) => siteKey('lt', post)));
  assert.deepEqual(written.catalogs['lt-test'], { indexedAt: '2026-10-18', capturedAt: '2026-10-18', pages: 2, cards: 4, excluded: expected.excluded });
  assert.ok(lines.some((line) => line.includes('Counts match vendors.json "expected".')), lines.join('\n'));
});

test('the walk stops before page 41, and a page robots.txt disallows is never requested', async () => {
  const endless = stubFetcher((url) => (url.endsWith('/robots.txt') ? '' : page([card({ post: 800 + Number(url.match(/page\/(\d+)\//)?.[1] ?? 1) })], { number: Number(url.match(/page\/(\d+)\//)?.[1] ?? 1) })));
  const vendors = { vendors: [{ ...vendor, catalogs: [catalog] }] };
  await assert.rejects(importSite({ vendorId: vendor.id, vendors, outFile: path.join(await mkdtemp(path.join(tmpdir(), 'props-lt-')), 'inventory.json'), fetcher: endless, exclusions: {}, log: () => {} }), /goes on past 40 pages; stopping before page 41/);
  assert.equal(endless.requested.length, 41, 'robots.txt and 40 pages');
  assert.equal(endless.requested.at(-1), 'https://shop.example/shop/page/40/');
  const barred = stubFetcher({ 'https://shop.example/robots.txt': 'User-agent: *\nDisallow: /shop/page/\n', 'https://shop.example/shop/': page([card({ post: 900 })]) });
  await assert.rejects(importSite({ vendorId: vendor.id, vendors, outFile: path.join(await mkdtemp(path.join(tmpdir(), 'props-lt-')), 'inventory.json'), fetcher: barred, exclusions: {}, log: () => {} }), /disallows https:\/\/shop\.example\/shop\/page\/2\/; not requesting it/);
  assert.deepEqual(barred.requested, ['https://shop.example/robots.txt', 'https://shop.example/shop/']);
});
