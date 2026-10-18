import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { PHOTO_BUCKET, PHOTO_HOST, nextSubcategoryPage, parseCatalog, photoProblem, subcategoryPages } from '../scripts/props/sites/bespoke-event-rentals.mjs';

const SITE = 'https://rentals.example/';
const COLLECTION = `${SITE}categories/furniture-rentals-collection/`;
const vendor = { id: 'tapgoods-test', name: 'Test Event Rentals', keyPrefix: 'te' };
const catalog = { id: 'te-test', type: 'tapgoods-catalog', sourceUrl: COLLECTION, siteUrl: SITE, itemLinkLabel: 'Open product page', photoHost: PHOTO_HOST };
const photo = (number, query = '?1770128177') => `https://${PHOTO_HOST}${PHOTO_BUCKET}pictures/images/000/900/${number}/original/blob${query}`;
const tile = (href, image, caption, price = '') => `<div class="catalog-item">\n  <a href="${href}">\n    <img src="${image}" alt="made-up alt">\n  </a>\n  <div class="caption font-bold">${caption}</div>${price ? `\n  <div class="product-price">${price} <span class="price-unit">/ Unit price</span></div>` : ''}\n</div>`;
const product = (slug, name, number, price = '$349.99') => tile(`${SITE}products/${slug}/`, photo(number), name, price);
const head = (next) => `<head>${next ? `<link rel="next" href="${next}" />` : ''}</head>`;
const collectionPage = (subcategories, next = `${COLLECTION}page/2/`) => `<html>${head(next)}<body><h1 class="tag-title">Furniture Rentals Collection</h1><div class="row">${subcategories.map(([slug, label]) => tile(`${COLLECTION}${slug}/`, 'https://tapgoods-prod.imgix.net/pictures/images/000/1/original/blob?w=400&#038;h=400&#038;auto=format', label)).join('')}</div></body></html>`;
const subcategoryPage = (heading, tiles, next = null) => `<html>${head(next)}<body><h1 class="tag-title">\n  ${heading}\n</h1><div class="row">${tiles.join('')}</div></body></html>`;
const parse = (pages, collection = collectionPage([['sofa-loveseats', 'Sofa &amp; Loveseats']])) => parseCatalog({ collection, pages }, { vendor, catalog });

test("the collection page's tiles give its subcategory pages; a tile linking anywhere else stops before any request", () => {
  assert.deepEqual(subcategoryPages(collectionPage([['benches', 'Benches'], ['sofa-loveseats', 'Sofa &amp; Loveseats']]), catalog), [
    { url: `${COLLECTION}benches/`, label: 'Benches' },
    { url: `${COLLECTION}sofa-loveseats/`, label: 'Sofa & Loveseats' },
  ]);
  for (const href of ['https://other.example/categories/furniture-rentals-collection/benches/', `${COLLECTION}benches/extra/`, `${COLLECTION}benches/?sort=1`, `${SITE}categories/linen-collection/`, `${COLLECTION}benches`]) {
    const html = collectionPage([]).replace('<div class="row">', `<div class="row">${tile(href, photo(1), 'Odd')}`);
    assert.throws(() => subcategoryPages(html, catalog), /not a page directly under it; stopping before any request/, href);
  }
  assert.throws(() => subcategoryPages(collectionPage([]), catalog), /links no subcategory pages/);
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

test("a subcategory page's next page is followed only to the same path plus page/N/, up to 10 pages", () => {
  const first = `${COLLECTION}chairs/`;
  assert.equal(nextSubcategoryPage(subcategoryPage('Chairs', [], null), first, 1), null);
  assert.equal(nextSubcategoryPage(subcategoryPage('Chairs', [], `${first}page/2/`), first, 1), `${first}page/2/`);
  assert.equal(nextSubcategoryPage(subcategoryPage('Chairs', [], `${first}page/3/`), first, 2), `${first}page/3/`);
  for (const next of [`${first}page/3/`, `${COLLECTION}benches/page/2/`, `${first}page/2/?x=1`, `https://other.example/x/`]) {
    assert.throws(() => nextSubcategoryPage(subcategoryPage('Chairs', [], next), first, 1), /names its next page as/, next);
  }
  assert.throws(() => nextSubcategoryPage(subcategoryPage('Chairs', [], `${first}page/11/`), first, 10), /goes on past 10 pages/);
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

test("the import reads robots.txt with its pre-group Crawl-delay, the collection page, then each subcategory page and its next pages, never the collection's own next page", async () => {
  const chairs = `${COLLECTION}chairs/`;
  const benches = `${COLLECTION}benches/`;
  const responses = new Map([
    [`${SITE}robots.txt`, '\tCrawl-delay: 10\n# START YOAST BLOCK\nUser-agent: *\nDisallow:\n'],
    [COLLECTION, collectionPage([['chairs', 'Chairs'], ['benches', 'Benches']])],
    [chairs, subcategoryPage('Chairs', [product('ghost-chair', 'Ghost Chair', 1)], `${chairs}page/2/`)],
    [`${chairs}page/2/`, subcategoryPage('Chairs', [product('wingback-chair', 'Wingback Chair', 2)])],
    [benches, subcategoryPage('Benches', [product('church-pew', 'Church Pew Bench', 3)])],
  ]);
  const requested = [];
  const gaps = [];
  const fetcher = {
    get: async (url) => {
      requested.push(url);
      const fetchedAt = url === benches ? '2026-10-18T12:00:00.000Z' : '2026-10-18T14:00:00.000Z';
      return { body: Buffer.from(responses.get(url)), meta: { url, status: 200, fetchedAt }, cached: false, missing: false };
    },
    raiseGap: (milliseconds) => gaps.push(milliseconds),
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'props-tapgoods-'));
  const { items, parsed } = await importSite({ vendorId: vendor.id, vendors: { vendors: [{ ...vendor, catalogs: [catalog] }] }, outFile: path.join(directory, 'inventory.json'), cacheRoot: directory, fetcher, exclusions: {}, log: () => {}, today: () => '2026-10-18' });
  assert.deepEqual(requested, [`${SITE}robots.txt`, COLLECTION, chairs, `${chairs}page/2/`, benches]);
  assert.deepEqual(gaps, [10_000], "the pre-group Crawl-delay slows every request");
  assert.deepEqual(items.map((item) => [item.name, item.categories[0]]), [['Ghost Chair', 'Chairs'], ['Wingback Chair', 'Chairs'], ['Church Pew Bench', 'Benches']]);
  assert.equal(parsed.capturedAt, '2026-10-18', 'the earliest page dates the snapshot');
  assert.deepEqual(parsed.counts, { pages: 3, tiles: 3, items: 3, merged: 0 });
});
