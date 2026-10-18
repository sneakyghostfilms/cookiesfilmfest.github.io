import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildSiteAssets } from '../scripts/props/demo.mjs';
import { importSite } from '../scripts/props/import-site.mjs';
import { cacheName, createSiteFetcher } from '../scripts/props/site-fetch.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { categoryPage, checkPages, parseCategories } from '../scripts/props/sites/event-source.mjs';

const SITE = 'https://store.example/';
const SITEMAP_URL = `${SITE}media/sitemap.xml`;
const vendor = { id: 'magento-test', name: 'Test Event Source', keyPrefix: 'mt' };
const catalogOf = (pages) => ({ id: 'mt-test', type: 'magento-category', title: 'Test category pages', siteUrl: SITE, sitemapUrl: SITEMAP_URL, pages, itemLinkLabel: 'Open product page' });
const catalog = catalogOf([`${SITE}furniture/sofas.html`]);
// Magento's toolbar forms, as its template writes them.
const items = (total) => `<span class="toolbar-number">${total}</span> ${total === 1 ? 'Item' : 'Items'}`;
const range = (first, last, total) => `Items <span class="toolbar-number">${first}</span>-<span class="toolbar-number">${last}</span> of <span class="toolbar-number">${total}</span>`;
const tile = (href, name) => `<li class="item product product-item"><a href="${href}" class="product photo product-item-photo"><img src="${SITE}media/catalog/product/x.jpg?width=240" alt="made-up alt"></a><strong class="product name product-item-name"><a class="product-item-link" href="${href}">\n    ${name}    </a></strong></li>`;
const categoryHtml = (heading, products, toolbars = [items(products.length)]) => `<html><body><div class="page-title-wrapper"><h1 class="page-title" id="page-title-heading" aria-labelledby="page-title-heading&#x20;toolbar-amount"><span class="base">${heading}</span></h1></div>${toolbars.map((text) => `<p class="toolbar-amount" id="toolbar-amount">${text}</p>`).join('')}<ol class="products list items product-items">${products.map(([href, name]) => tile(href, name)).join('')}</ol></body></html>`;
const product = (slug, name) => [`${SITE}${slug}.html`, name];
const sitemapOf = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join('\n')}</urlset>\n`;
const parsePages = (pages) => parseCategories(pages.map(([url, html]) => categoryPage(html, url, SITE)), { vendor, catalog });

test("a category page's toolbar reads in Magento's three forms, and every toolbar must agree", () => {
  const sofas = [product('eden-sofa', 'Eden Sofa'), product('adams-loveseat', 'Adams Loveseat'), product('rylee-sofa', 'Rylee Sofa')];
  for (const toolbars of [[items(3)], [range(1, 3, 3)], [items(3), items(3)], [items(3), range(1, 3, 3)]]) {
    assert.equal(categoryPage(categoryHtml('Sofas', sofas, toolbars), `${SITE}furniture/sofas.html`, SITE).products.length, 3, toolbars.join(' / '));
  }
  assert.equal(categoryPage(categoryHtml('Bookcases', [product('oak-bookcase', 'Oak Bookcase')], [items(1)]), `${SITE}furniture/bookcases.html`, SITE).products.length, 1, '"1 Item"');
});

test('a missing, unreadable or disagreeing toolbar, or a count the links do not meet, stops the import, naming the page', () => {
  const url = `${SITE}furniture/rugs.html`;
  const rugs = [product('kilim-rug', 'Kilim Rug'), product('jute-rug', 'Jute Rug')];
  assert.throws(() => categoryPage(categoryHtml('Rugs', rugs, []), url, SITE), /furniture\/rugs\.html shows no item count; the page layout has changed/);
  assert.throws(() => categoryPage(categoryHtml('Rugs', rugs, ['Showing 2 results']), url, SITE), /its item count reads "Showing 2 results", a form this import doesn't read/);
  assert.throws(() => categoryPage(categoryHtml('Rugs', rugs, [items(2), range(1, 2, 3)]), url, SITE), /shows item counts that disagree \(2, 3\)/);
  assert.throws(() => categoryPage(categoryHtml('Rugs', rugs, [range(1, 2, 3)]), url, SITE), /lists 2 products, but its item count says 3; a category must fit on its first page, since a page past the first needs a query robots\.txt refuses/);
  assert.throws(() => categoryPage(categoryHtml('Rugs', rugs, [items(1)]), url, SITE), /lists 2 products, but its item count says 1; the page layout has changed/);
  assert.throws(() => categoryPage(categoryHtml('Rugs', [rugs[0], rugs[0]], [items(2)]), url, SITE), /links the product \/kilim-rug\.html twice/);
});

test("each product link becomes an item: the link text decoded as the name, the page's heading as the category, the product page as the link; no price, description or photo", () => {
  const parsed = parsePages([[`${SITE}furniture/sofas.html`, categoryHtml('Sofas &amp; Loveseats', [product('eden-sofa', 'Eden Sofa'), product('mid-century-sofa', '1960s Walnut Sofa &#8211; Teal'), [`${SITE}wine barrel.html`, 'Wine Barrel']])]]);
  assert.deepEqual(parsed.items.map((item) => [item.key, item.name, item.categories, item.era, item.decades, item.url, item.description]), [
    [siteKey('mt', '/eden-sofa.html'), 'Eden Sofa', ['Sofas & Loveseats'], null, [], `${SITE}eden-sofa.html`, null],
    [siteKey('mt', '/mid-century-sofa.html'), '1960s Walnut Sofa – Teal', ['Sofas & Loveseats'], '1960s', [1960], `${SITE}mid-century-sofa.html`, null],
    [siteKey('mt', '/wine%20barrel.html'), 'Wine Barrel', ['Sofas & Loveseats'], null, [], `${SITE}wine%20barrel.html`, null],
  ], 'a raw space in a path is kept as the URL parser writes it, and the key is made from that same path');
  assert.deepEqual([...parsed.images.values()], [{ urls: [] }, { urls: [] }, { urls: [] }], 'no photo is kept');
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
  assert.doesNotMatch(JSON.stringify(parsed.items), /media\/catalog|width=/, 'no photo URL is kept');
  assert.deepEqual(parsed.counts, { pages: 1, products: 3, items: 3, merged: 0 });
  assert.match(parsed.report.join('\n'), /Product links with an encoded character in their path, kept as the URL parser writes them: 1/);
  assert.match(parsed.report.join('\n'), /Photos: none/);
});

test('a heading that is missing, a product link off the host or with a query or fragment, a name left with an entity, or no name, stops the parse', () => {
  const url = `${SITE}furniture/ottomans.html`;
  const one = (href, name) => categoryHtml('Ottomans', [[href, name]]);
  assert.throws(() => categoryPage(categoryHtml('', [product('cube', 'Cube Ottoman')]), url, SITE), /has no category heading/);
  assert.throws(() => categoryPage(categoryHtml('Ottomans', [product('cube', 'Cube Ottoman')]).replace('class="page-title"', 'class="page-title-wrapper"'), url, SITE), /has no category heading/, 'page-title-wrapper is not page-title');
  assert.throws(() => categoryPage(one('https://other.example/cube.html', 'Cube Ottoman'), url, SITE), /links https:\/\/other\.example\/cube\.html, not a page on store\.example/);
  assert.throws(() => categoryPage(one(`${SITE}cube.html?srsltid=REDACTED`, 'Cube Ottoman'), url, SITE), /carries a query or fragment/);
  assert.throws(() => categoryPage(one(`${SITE}cube.html#reviews`, 'Cube Ottoman'), url, SITE), /carries a query or fragment/);
  assert.throws(() => categoryPage(one(`${SITE}cube.html`, 'Cube &bogus; Ottoman'), url, SITE), /holds &bogus;, an entity this import can't decode/);
  assert.throws(() => categoryPage(one(`${SITE}cube.html`, '   '), url, SITE), /has no name/);
});

test('the same product on two pages is one item, with both categories in page order and the first name; two product pages with one name stay two items', () => {
  const parsed = parsePages([
    [`${SITE}furniture/chairs.html`, categoryHtml('Lounge Chairs', [product('bergere-chair', 'Bergere Chair'), product('club-chair', 'Club Chair')])],
    [`${SITE}outdoor.html`, categoryHtml('Outdoor Furniture', [product('bergere-chair', 'Bergère Chair'), product('club-chair-2', 'Club Chair')])],
  ]);
  const keys = ['bergere-chair', 'club-chair', 'club-chair-2'].map((slug) => siteKey('mt', `/${slug}.html`));
  assert.deepEqual(parsed.items.map((item) => [item.key, item.name, item.categories]), [
    [keys[0], 'Bergere Chair', ['Lounge Chairs', 'Outdoor Furniture']],
    [keys[1], 'Club Chair', ['Lounge Chairs']],
    [keys[2], 'Club Chair', ['Outdoor Furniture']],
  ]);
  assert.deepEqual(parsed.counts, { pages: 2, products: 4, items: 3, merged: 1 });
  const report = parsed.report.join('\n');
  assert.match(report, /"Bergere Chair" is listed on 2 category pages \(Lounge Chairs, Outdoor Furniture\); one item/);
  assert.match(report, /"Bergere Chair" is also named "Bergère Chair" on a later page; the first page's name is kept/);
  assert.match(report, /"Club Chair" names 2 product pages .*; items merge by product page, so they stay 2 items/);
});

test("every page in the catalog's list must be a plain page on the site's host that the sitemap lists", () => {
  const pages = [`${SITE}furniture/sofas.html`, `${SITE}bars/back-bars.html`];
  const sitemap = sitemapOf([SITE, ...pages, `${SITE}eden-sofa.html`]);
  assert.doesNotThrow(() => checkPages(pages, sitemap, SITE));
  assert.doesNotThrow(() => checkPages([`${SITE}a&b.html`], sitemapOf([`${SITE}a&amp;b.html`]), SITE), 'the sitemap is entity-decoded');
  assert.throws(() => checkPages([...pages, `${SITE}furniture/modular.html`], sitemap, SITE), /furniture\/modular\.html is not in the sitemap; stopping before any page request/);
  for (const page of ['https://other.example/furniture/sofas.html', `${SITE}furniture/sofas.html?p=2`, `${SITE}furniture/sofas.html#top`, 'HTTPS://store.example/furniture/sofas.html', 'not a url']) {
    assert.throws(() => checkPages([page], sitemapOf([page]), SITE), /is not a plain page on store\.example; stopping before any page request/, page);
  }
  assert.throws(() => checkPages([pages[0], pages[0]], sitemap, SITE), /lists a category page twice/);
  assert.throws(() => checkPages([], sitemap, SITE), /lists no category pages/);
});

// The import through the real fetcher on a temporary cache: the sitemap seeded there, every other URL answered by a
// stub network that records each request. No wait is real, and every page is fetched at noon UTC.
async function importWithCache({ pages, responses, sitemap = sitemapOf(pages), fetchSitemap = false }) {
  const cacheRoot = await mkdtemp(path.join(tmpdir(), 'props-magento-'));
  const directory = path.join(cacheRoot, vendor.id, 'mt-test');
  await mkdir(directory, { recursive: true });
  if (sitemap !== null) {
    const name = cacheName(SITEMAP_URL);
    await writeFile(path.join(directory, `${name}.body`), sitemap);
    await writeFile(path.join(directory, `${name}.meta.json`), `${JSON.stringify({ url: SITEMAP_URL, status: 200, contentType: 'text/xml', fetchedAt: '2026-10-17T12:00:00.000Z' })}\n`);
  }
  const requested = [];
  const network = async (url) => {
    requested.push(String(url));
    const body = responses.get(String(url));
    if (body === undefined) return new Response('not found', { status: 404 });
    const contentType = String(url).endsWith('robots.txt') ? 'text/plain' : String(url).endsWith('.xml') ? 'application/xml' : 'text/html; charset=UTF-8';
    return new Response(body, { status: 200, headers: { 'content-type': contentType } });
  };
  const fetcher = createSiteFetcher({ allowHosts: ['store.example'], fetch: network, sleep: async () => {}, random: () => 0, now: () => Date.parse('2026-10-18T12:00:00.000Z'), guard: () => null });
  const result = await importSite({ vendorId: vendor.id, vendors: { vendors: [{ ...vendor, catalogs: [catalogOf(pages)] }] }, outFile: path.join(cacheRoot, 'inventory.json'), cacheRoot, fetcher, fetchSitemap, exclusions: {}, log: () => {}, today: () => '2026-10-18' })
    .catch((error) => ({ error }));
  return { requested, stats: fetcher.stats(), directory, ...result };
}

const ROBOTS = 'User-agent: *\nDisallow: /index.php/\nDisallow: /*?\nDisallow: /catalog/\n';
const SOFAS = `${SITE}furniture/sofas.html`;
const BACK_BARS = `${SITE}bars/back-bars.html`;
const RUGS = `${SITE}furniture/rugs.html`;

test("the import reads the sitemap from the cache only, then robots.txt, then each listed page in order; nothing else is requested", async () => {
  const responses = new Map([
    [`${SITE}robots.txt`, ROBOTS],
    [SOFAS, categoryHtml('Sofas', [product('eden-sofa', 'Eden Sofa'), product('adams-loveseat', 'Adams Loveseat')])],
    [BACK_BARS, categoryHtml('Back Bars', [product('mahogany-back-bar', 'Mahogany Back Bar')], [items(1)])],
  ]);
  const { requested, stats, items: written, parsed, error } = await importWithCache({ pages: [SOFAS, BACK_BARS], responses });
  assert.equal(error, undefined, String(error?.message));
  assert.deepEqual(requested, [`${SITE}robots.txt`, SOFAS, BACK_BARS], 'the sitemap is never requested');
  assert.equal(stats.cacheHits, 1, 'the sitemap came from the cache');
  assert.deepEqual(written.map((item) => [item.name, item.categories]), [['Eden Sofa', ['Sofas']], ['Adams Loveseat', ['Sofas']], ['Mahogany Back Bar', ['Back Bars']]]);
  assert.equal(parsed.capturedAt, '2026-10-18');
  assert.deepEqual(parsed.counts, { pages: 2, products: 3, items: 3, merged: 0 });
});

test('a sitemap missing from the cache, or a listed page the sitemap lacks, stops the import before any request', async () => {
  const responses = new Map([[`${SITE}robots.txt`, ROBOTS], [SOFAS, categoryHtml('Sofas', [product('eden-sofa', 'Eden Sofa')], [items(1)])]]);
  const missing = await importWithCache({ pages: [SOFAS], responses, sitemap: null });
  assert.match(String(missing.error?.message), /media\/sitemap\.xml is not in the cache, and this run reads it only from there; not requesting it/);
  assert.deepEqual(missing.requested, []);
  const unlisted = await importWithCache({ pages: [SOFAS, RUGS], responses, sitemap: sitemapOf([SOFAS]) });
  assert.match(String(unlisted.error?.message), /furniture\/rugs\.html is not in the sitemap; stopping before any page request/);
  assert.deepEqual(unlisted.requested, []);
});

test('--fetch-sitemap fetches a sitemap the cache lacks once, after robots.txt, into the cache; a sitemap already cached is never requested', async () => {
  const responses = new Map([
    [`${SITE}robots.txt`, ROBOTS],
    [SITEMAP_URL, sitemapOf([SOFAS, `${SITE}eden-sofa.html?srsltid=AfmBOop-tracking`])],
    [SOFAS, categoryHtml('Sofas', [product('eden-sofa', 'Eden Sofa')], [items(1)])],
  ]);
  const fetched = await importWithCache({ pages: [SOFAS], responses, sitemap: null, fetchSitemap: true });
  assert.equal(fetched.error, undefined, String(fetched.error?.message));
  assert.deepEqual(fetched.requested, [`${SITE}robots.txt`, SITEMAP_URL, SOFAS], 'robots.txt first, the sitemap once, then each page');
  const meta = JSON.parse(await readFile(path.join(fetched.directory, `${cacheName(SITEMAP_URL)}.meta.json`), 'utf8'));
  assert.deepEqual([meta.url, meta.redacted], [SITEMAP_URL, ['srsltid']], "the sitemap is in the catalog's cache, redacted like any fetch");
  assert.match(await readFile(path.join(fetched.directory, `${cacheName(SITEMAP_URL)}.body`), 'utf8'), /srsltid=REDACTED/);
  assert.equal(fetched.stats.cacheHits, 1, 'the import then read the sitemap from the cache');
  const cached = await importWithCache({ pages: [SOFAS], responses, fetchSitemap: true });
  assert.equal(cached.error, undefined, String(cached.error?.message));
  assert.deepEqual(cached.requested, [`${SITE}robots.txt`, SOFAS], 'a cached sitemap is never requested, flag or not');
  const disallowed = await importWithCache({ pages: [SOFAS], responses: new Map([...responses, [`${SITE}robots.txt`, `${ROBOTS}Disallow: /media/\n`]]), sitemap: null, fetchSitemap: true });
  assert.match(String(disallowed.error?.message), /robots\.txt on store\.example disallows https:\/\/store\.example\/media\/sitemap\.xml; not requesting it/);
  assert.deepEqual(disallowed.requested, [`${SITE}robots.txt`], 'robots.txt is read before the sitemap is requested');
});

test('a page that fails its checks stops the import before the next request, and a page robots.txt disallows is never requested', async () => {
  const responses = new Map([
    [`${SITE}robots.txt`, ROBOTS],
    [SOFAS, categoryHtml('Sofas', [product('eden-sofa', 'Eden Sofa')], [items(1)])],
    [RUGS, categoryHtml('Rugs', [product('kilim-rug', 'Kilim Rug')], [range(1, 1, 2)])],
    [BACK_BARS, categoryHtml('Back Bars', [product('mahogany-back-bar', 'Mahogany Back Bar')], [items(1)])],
  ]);
  const short = await importWithCache({ pages: [SOFAS, RUGS, BACK_BARS], responses });
  assert.match(String(short.error?.message), /rugs\.html lists 1 products, but its item count says 2/);
  assert.deepEqual(short.requested, [`${SITE}robots.txt`, SOFAS, RUGS], 'the page after the failing one is never requested');
  const disallowed = await importWithCache({ pages: [SOFAS, BACK_BARS], responses: new Map([...responses, [`${SITE}robots.txt`, `${ROBOTS}Disallow: /bars/\n`]]) });
  assert.match(String(disallowed.error?.message), /robots\.txt on store\.example disallows https:\/\/store\.example\/bars\/back-bars\.html; not requesting it/);
  assert.deepEqual(disallowed.requested, [`${SITE}robots.txt`, SOFAS]);
});

test("the demo's photo step makes no request, not even for robots.txt, when no kept item has a photo", async () => {
  const calls = [];
  const lines = [];
  const { fetch: realFetch } = globalThis;
  const { log: realLog } = console;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('no request may be made');
  };
  console.log = (line) => lines.push(String(line));
  try {
    // A real vendor's catalog record, with the cache-only import replaced by a text-only answer, so neither the cache nor
    // the demo folder is read or written.
    await buildSiteAssets('dezzign-central', undefined, { load: async () => ({ items: [{ key: 'dz-test01' }, { key: 'dz-test02' }], images: new Map([['dz-test01', { urls: [] }], ['dz-test02', { urls: [] }]]) }) });
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(lines, ['No photo to fetch for Dezzign Central: none of its 2 items keeps one, so no request was made.']);
});
