import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { PHOTO_BUCKET, PHOTO_HOST, nextSubcategoryPage, parseCatalog, photoProblem, subcategoryPages, tagArchivePager } from '../scripts/props/sites/bespoke-event-rentals.mjs';

const SITE = 'https://rentals.example/';
const COLLECTION = `${SITE}categories/furniture-rentals-collection/`;
const BAR = `${SITE}categories/bar-collection/`;
const vendor = { id: 'tapgoods-test', name: 'Test Event Rentals', keyPrefix: 'te' };
const catalogOf = (collections) => ({ id: 'te-test', type: 'tapgoods-catalog', siteUrl: SITE, collections, itemLinkLabel: 'Open product page', photoHost: PHOTO_HOST });
const catalog = catalogOf([{ url: COLLECTION, subcategories: ['sofa-loveseats'] }]);
const photo = (number, query = '?1770128177') => `https://${PHOTO_HOST}${PHOTO_BUCKET}pictures/images/000/900/${number}/original/blob${query}`;
const tile = (href, image, caption, price = '') => `<div class="catalog-item">\n  <a href="${href}">\n    <img src="${image}" alt="made-up alt">\n  </a>\n  <div class="caption font-bold">${caption}</div>${price ? `\n  <div class="product-price">${price} <span class="price-unit">/ Unit price</span></div>` : ''}\n</div>`;
const product = (slug, name, number, price = '$349.99') => tile(`${SITE}products/${slug}/`, photo(number), name, price);
const head = (next) => `<head>${next ? `<link rel="next" href="${next}" />` : ''}</head>`;
const collectionPage = (subcategories, next = `${COLLECTION}page/2/`, base = COLLECTION) => `<html>${head(next)}<body><h1 class="category-title">A Collection</h1><div class="row">${subcategories.map(([slug, label]) => tile(`${base}${slug}/`, 'https://tapgoods-prod.imgix.net/pictures/images/000/1/original/blob?w=400&#038;h=400&#038;auto=format', label)).join('')}</div></body></html>`;
const subcategoryPage = (heading, tiles, next = null) => `<html>${head(next)}<body><h1 class="tag-title">\n  ${heading}\n</h1><div class="row">${tiles.join('')}</div></body></html>`;
const parse = (pages, collections = [{ url: COLLECTION, subcategories: ['sofa-loveseats'], html: collectionPage([['sofa-loveseats', 'Sofa &amp; Loveseats']]) }]) => parseCatalog({ collections, pages }, { vendor, catalog });

test("a collection page's tiles give its subcategory pages; a tile linking anywhere else stops before any subcategory request", () => {
  const furniture = { url: COLLECTION, subcategories: ['benches', 'sofa-loveseats'] };
  assert.deepEqual(subcategoryPages(collectionPage([['benches', 'Benches'], ['sofa-loveseats', 'Sofa &amp; Loveseats']]), furniture), {
    listed: [
      { url: `${COLLECTION}benches/`, label: 'Benches', slug: 'benches' },
      { url: `${COLLECTION}sofa-loveseats/`, label: 'Sofa & Loveseats', slug: 'sofa-loveseats' },
    ],
    skipped: [],
  });
  for (const href of ['https://other.example/categories/furniture-rentals-collection/benches/', `${COLLECTION}benches/extra/`, `${COLLECTION}benches/?sort=1`, `${SITE}categories/linen-collection/`, `${COLLECTION}benches`]) {
    const html = collectionPage([]).replace('<div class="row">', `<div class="row">${tile(href, photo(1), 'Odd')}`);
    assert.throws(() => subcategoryPages(html, furniture), /not a page directly under it; stopping before any subcategory request/, href);
  }
  assert.throws(() => subcategoryPages(collectionPage([]), furniture), /links no subcategory pages/);
});

test("a tile not on its collection's list is skipped and named; a listed slug the page doesn't link stops, naming it", () => {
  const page = collectionPage([['bar-back-collection', 'Bar Back Collection'], ['folding-bars', 'Folding Bars'], ['heritage-bar-collection', 'Heritage Bar Collection']], null, BAR);
  assert.deepEqual(subcategoryPages(page, { url: BAR, subcategories: ['heritage-bar-collection', 'bar-back-collection'] }), {
    listed: [
      { url: `${BAR}bar-back-collection/`, label: 'Bar Back Collection', slug: 'bar-back-collection' },
      { url: `${BAR}heritage-bar-collection/`, label: 'Heritage Bar Collection', slug: 'heritage-bar-collection' },
    ],
    skipped: ['Folding Bars'],
  }, "the page's order, not the list's");
  assert.throws(() => subcategoryPages(page, { url: BAR, subcategories: ['bar-back-collection', 'podiums', 'easels'] }),
    /bar-collection\/ doesn't link podiums, easels, on its list in vendors\.json; stopping before any subcategory request/);
});

test('product tiles become items: the caption decoded as the name, the heading as the category, the product link; no price is kept', () => {
  const page = subcategoryPage('Sofa &amp; Loveseats', [
    product('crosby-sofa', 'Crosby Taupe Tufted Back Sofa', 423),
    product('hamptons-couch', 'Hampton&#8217;s Black Frame 3 Seat Couch &#8211; Grey   Cushion', 424, '$369.99'),
    product('atomic-lamp', '1960s Atomic Floor Lamp', 425),
  ]);
  const parsed = parse([{ url: `${COLLECTION}sofa-loveseats/`, html: page }]);
  assert.deepEqual(parsed.items.map((item) => [item.name, item.categories, item.era, item.decades, item.url]), [
    ['Crosby Taupe Tufted Back Sofa', ['Sofa & Loveseats'], null, [], `${SITE}products/crosby-sofa/`],
    ['Hampton’s Black Frame 3 Seat Couch – Grey Cushion', ['Sofa & Loveseats'], null, [], `${SITE}products/hamptons-couch/`],
    ['1960s Atomic Floor Lamp', ['Sofa & Loveseats'], '1960s', [1960], `${SITE}products/atomic-lamp/`],
  ]);
  assert.deepEqual(parsed.items.map((item) => item.key), ['crosby-sofa', 'hamptons-couch', 'atomic-lamp'].map((slug) => siteKey('te', slug)));
  assert.deepEqual(parsed.images.get(siteKey('te', 'crosby-sofa')), { urls: [photo(423)] });
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
  assert.doesNotMatch(JSON.stringify(parsed.items), /349|369|Unit price/, 'no price is kept');
  assert.deepEqual(parsed.counts, { pages: 1, tiles: 3, items: 3, merged: 0 });
  assert.match(parsed.report.join('\n'), /its own next page \(https:\/\/rentals\.example\/categories\/furniture-rentals-collection\/page\/2\/\) is not followed/);
});

test('the same product on two subcategory pages is one item, with both categories in page order and the first link', () => {
  const parsed = parse([
    { url: `${COLLECTION}soho-collection/`, html: subcategoryPage('SoHo Collection', [product('soho-chair', 'SoHo Chair', 1), product('soho-sofa', 'SoHo Sofa', 2)]) },
    { url: `${COLLECTION}chairs/`, html: subcategoryPage('Chairs', [product('soho-chair', 'SoHo Chair', 1), product('ghost-chair', 'Ghost Chair', 3)]) },
  ]);
  assert.deepEqual(parsed.items.map((item) => [item.name, item.categories]), [['SoHo Chair', ['SoHo Collection', 'Chairs']], ['SoHo Sofa', ['SoHo Collection']], ['Ghost Chair', ['Chairs']]]);
  assert.deepEqual(parsed.counts, { pages: 2, tiles: 4, items: 3, merged: 1 });
  assert.match(parsed.report.join('\n'), /"SoHo Chair" appears on 2 subcategory pages \(SoHo Collection, Chairs\); one item/);
});

test('two product pages with one name stay two items, and the report says so', () => {
  const parsed = parse([{ url: `${COLLECTION}benches/`, html: subcategoryPage('Benches', [product('outdoor-bench-2', 'Outdoor Bench', 1), product('outdoor-bench-3', 'Outdoor Bench', 2)]) }]);
  const keys = ['outdoor-bench-2', 'outdoor-bench-3'].map((slug) => siteKey('te', slug));
  assert.deepEqual(parsed.items.map((item) => [item.key, item.name]), [[keys[0], 'Outdoor Bench'], [keys[1], 'Outdoor Bench']]);
  assert.deepEqual(parsed.report.filter((line) => /names 2 product pages/.test(line)), [`  "Outdoor Bench" names 2 product pages (${keys.join(', ')}); items merge by product page, so they stay 2 items`]);
});

test("a subcategory page's next page is followed only on its own path; its slug's tag archive is named and not followed; any other next link stops", () => {
  const first = `${COLLECTION}chairs/`;
  const next = (href, number = 1) => nextSubcategoryPage(subcategoryPage('Chairs', [], href), first, number);
  assert.equal(next(null), null);
  assert.equal(next(`${first}page/2/`), `${first}page/2/`);
  assert.equal(next(`${first}page/3/`, 2), `${first}page/3/`);
  assert.throws(() => next(`${first}page/11/`, 10), /goes on past 10 pages/);
  assert.equal(next(`${SITE}tags/chairs/page/2/`), null, 'the tag archive is not followed');
  assert.equal(tagArchivePager(subcategoryPage('Chairs', [], `${SITE}tags/chairs/page/2/`), first, 1), '/tags/chairs/page/2/');
  assert.equal(tagArchivePager(subcategoryPage('Chairs', [], `${SITE}tags/chairs/page/4/`), first, 3), '/tags/chairs/page/4/');
  for (const href of [`${first}page/3/`, `${SITE}tags/benches/page/2/`, `${SITE}tags/chairs/page/3/`, `${SITE}tags/chairs/page/2/?x=1`, `${SITE}tags/chairs/`, `https://other.example/tags/chairs/page/2/`, `${COLLECTION}benches/page/2/`, `${first}page/2/?x=1`]) {
    assert.equal(tagArchivePager(subcategoryPage('Chairs', [], href), first, 1), null, href);
    assert.throws(() => next(href), /names its next page as/, href);
  }
});

test("photos: only the vendor's bucket on the S3 host, with a query of digits alone", () => {
  assert.equal(photoProblem(photo(1)), null);
  const refused = [
    photo(1, '?v=1'),
    photo(1, '?1770128307&x=1'),
    photo(1, '?abc'),
    photo(1, '?'),
    photo(1, ''),
    photo(1, '?1770128307#x'),
    `https://${PHOTO_HOST}/another-bucket/pictures/images/000/1/original/blob?1770128307`,
    `https://tapgoods-prod.imgix.net${PHOTO_BUCKET}pictures/images/000/1/original/blob?1770128307`,
    `http://${PHOTO_HOST}${PHOTO_BUCKET}pictures/images/000/1/original/blob?1770128307`,
  ];
  for (const url of refused) assert.ok(photoProblem(url), url);
  const html = subcategoryPage('Chairs', [tile(`${SITE}products/ghost-chair/`, photo(1, '?v=1'), 'Ghost Chair', '$9.99')]);
  assert.throws(() => parse([{ url: `${COLLECTION}chairs/`, html }]), /The photo of "Ghost Chair" has a query other than a version stamp of digits alone; stopping/);
});

test('a product link off the host or with a query, a price for a caption, a missing heading or a changed tile layout stops the parse', () => {
  const page = (tiles, heading = 'Chairs') => [{ url: `${COLLECTION}chairs/`, html: subcategoryPage(heading, tiles) }];
  assert.throws(() => parse(page([tile('https://other.example/products/x/', photo(1), 'X')])), /not a product page on rentals\.example/);
  assert.throws(() => parse(page([tile(`${SITE}catalog/`, photo(1), 'X')])), /not a product page/);
  assert.throws(() => parse(page([tile(`${SITE}products/x/?srsltid=REDACTED`, photo(1), 'X')])), /carries a query \(srsltid\)/);
  assert.throws(() => parse(page([tile(`${SITE}products/x/`, photo(1), '$12.00')])), /has the caption "\$12\.00", not a name/);
  assert.throws(() => parse(page([product('x', 'X', 1)], '')), /has no subcategory heading/);
  const changed = subcategoryPage('Chairs', [product('x', 'X', 1).replace('<div class="caption font-bold">', '<span class="caption">').replace('</div>\n  <div class="product-price">', '</span>\n  <div class="product-price">')]);
  assert.throws(() => parse([{ url: `${COLLECTION}chairs/`, html: changed }]), /has 1 tiles, 0 of them in the layout this import reads/);
});

// The import through a stub fetcher answering from `responses`, with every URL requested and every gap raised.
async function importWith(responses, listed, fetchedAtOf = () => '2026-10-18T14:00:00.000Z') {
  const requested = [];
  const gaps = [];
  const fetcher = {
    get: async (url) => {
      requested.push(url);
      return { body: Buffer.from(responses.get(url)), meta: { url, status: 200, fetchedAt: fetchedAtOf(url) }, cached: false, missing: false };
    },
    raiseGap: (milliseconds) => gaps.push(milliseconds),
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'props-tapgoods-'));
  const result = await importSite({ vendorId: vendor.id, vendors: { vendors: [{ ...vendor, catalogs: [listed] }] }, outFile: path.join(directory, 'inventory.json'), cacheRoot: directory, fetcher, exclusions: {}, log: () => {}, today: () => '2026-10-18' })
    .catch((error) => ({ error }));
  return { requested, gaps, ...result };
}

test("the import reads robots.txt with its pre-group Crawl-delay, every collection page, then each listed subcategory page and its next pages; a skipped tile's page and the slug's tag archive are never requested", async () => {
  const chairs = `${COLLECTION}chairs/`;
  const benches = `${COLLECTION}benches/`;
  const stools = `${COLLECTION}stools/`;
  const backBars = `${BAR}bar-back-collection/`;
  const responses = new Map([
    [`${SITE}robots.txt`, '\tCrawl-delay: 10\n# START YOAST BLOCK\nUser-agent: *\nDisallow:\n'],
    [COLLECTION, collectionPage([['chairs', 'Chairs'], ['stools', 'Stools'], ['benches', 'Benches']])],
    [BAR, collectionPage([['bar-back-collection', 'Bar Back Collection'], ['folding-bars', 'Folding Bars']], `${BAR}page/2/`, BAR)],
    [chairs, subcategoryPage('Chairs', [product('ghost-chair', 'Ghost Chair', 1)], `${chairs}page/2/`)],
    [`${chairs}page/2/`, subcategoryPage('Chairs', [product('wingback-chair', 'Wingback Chair', 2)])],
    [stools, subcategoryPage('Stools', [product('bar-stool', 'Bar Stool', 4)], `${SITE}tags/stools/page/2/`)],
    [benches, subcategoryPage('Benches', [product('church-pew', 'Church Pew Bench', 3)])],
    [backBars, subcategoryPage('Bar Back Collection', [product('mahogany-back-bar', 'Mahogany Back Bar', 5)])],
  ]);
  const listed = catalogOf([{ url: COLLECTION, subcategories: ['chairs', 'stools', 'benches'] }, { url: BAR, subcategories: ['bar-back-collection'] }]);
  const { requested, gaps, items, parsed } = await importWith(responses, listed, (url) => (url === benches ? '2026-10-18T12:00:00.000Z' : '2026-10-18T14:00:00.000Z'));
  assert.deepEqual(requested, [`${SITE}robots.txt`, COLLECTION, BAR, chairs, `${chairs}page/2/`, stools, benches, backBars]);
  assert.deepEqual(gaps, [10_000], "the pre-group Crawl-delay slows every request");
  assert.deepEqual(items.map((item) => [item.name, item.categories[0]]), [['Ghost Chair', 'Chairs'], ['Wingback Chair', 'Chairs'], ['Bar Stool', 'Stools'], ['Church Pew Bench', 'Benches'], ['Mahogany Back Bar', 'Bar Back Collection']]);
  assert.equal(parsed.capturedAt, '2026-10-18', 'the earliest page dates the snapshot');
  assert.deepEqual(parsed.counts, { pages: 5, tiles: 5, items: 5, merged: 0 });
  assert.deepEqual(parsed.report.slice(0, 3), [
    'Collection pages: 2',
    `  ${COLLECTION}: 3 subcategory tiles, 3 on the list; its own next page (${COLLECTION}page/2/) is not followed, since its first page lists every subcategory`,
    `  ${BAR}: 2 subcategory tiles, 1 on the list; skipped: Folding Bars; its own next page (${BAR}page/2/) is not followed, since its first page lists every subcategory`,
  ]);
  assert.deepEqual(parsed.report.filter((line) => /pager/.test(line)), ['  Stools: pager leads to the tag archive /tags/stools/page/2/, not followed']);
});

test('a listed slug a collection page no longer links stops the import after the collection pages, before any subcategory page', async () => {
  const responses = new Map([
    [`${SITE}robots.txt`, 'User-agent: *\nDisallow:\n'],
    [COLLECTION, collectionPage([['chairs', 'Chairs']])],
    [BAR, collectionPage([['folding-bars', 'Folding Bars']], null, BAR)],
  ]);
  const listed = catalogOf([{ url: COLLECTION, subcategories: ['chairs'] }, { url: BAR, subcategories: ['bar-back-collection'] }]);
  const { requested, error } = await importWith(responses, listed);
  assert.match(String(error?.message), /bar-collection\/ doesn't link bar-back-collection, on its list in vendors\.json; stopping before any subcategory request/);
  assert.deepEqual(requested, [`${SITE}robots.txt`, COLLECTION, BAR], 'no subcategory page is requested');
});

test("a next link of any other form stops the import as a layout change, before it is requested", async () => {
  const stools = `${COLLECTION}stools/`;
  const responses = new Map([
    [`${SITE}robots.txt`, 'User-agent: *\nDisallow:\n'],
    [COLLECTION, collectionPage([['stools', 'Stools'], ['benches', 'Benches']])],
    [stools, subcategoryPage('Stools', [product('bar-stool', 'Bar Stool', 4)], `${SITE}tags/benches/page/2/`)],
  ]);
  const { requested, error } = await importWith(responses, catalogOf([{ url: COLLECTION, subcategories: ['stools', 'benches'] }]));
  assert.match(String(error?.message), /stools\/: page 1 names its next page as https:\/\/rentals\.example\/tags\/benches\/page\/2\/, not .*stools\/page\/2\/; stopping/);
  assert.deepEqual(requested, [`${SITE}robots.txt`, COLLECTION, stools], 'nothing after the stop');
});
