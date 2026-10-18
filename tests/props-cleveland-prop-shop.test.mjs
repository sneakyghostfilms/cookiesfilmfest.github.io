import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { CATEGORY_MENU, EXTRA_PAGES, galleryPages, parseGalleries } from '../scripts/props/sites/cleveland-prop-shop.mjs';

const SITE = 'https://gallery.example/';
const vendor = { id: 'gallery-test', name: 'Test Gallery Shop', keyPrefix: 'gt', catalogs: [] };
const catalog = { id: 'gt-test', type: 'weebly-gallery', sourceUrl: SITE, siteUrl: SITE, itemLinkLabel: 'Open gallery page' };
const ZERO_WIDTH = '&#8203;';

const menuItem = (label, href) => `<li class="wsite-menu-item-wrap">\n\t<a\n\t\thref="${href}"\n\t\tclass="wsite-menu-item"\n\t\t>\n\t\t${label}\n\t</a>`;
const subItem = (label, href) => `<li class="wsite-menu-subitem-wrap "><a\n\t\thref="${href}"\n\t\tclass="wsite-menu-subitem"><span class="wsite-menu-title">\n\t\t\t${label}\n\t\t</span></a></li>`;
function menu({ group = [['Lamps', '/lamps.html'], ['seating', '/chairs.html']], extra = '/sale-page.html' } = {}) {
  const one = `<ul class="wsite-menu-default">${menuItem('Home', '/')}</li>${menuItem(CATEGORY_MENU, '/things.html')}<div class="wsite-menu-wrap"><ul class="wsite-menu">${group.map(([label, href]) => subItem(label, href)).join('')}</ul></div></li>${menuItem('About', '/about.html')}</li>${extra ? `${menuItem(EXTRA_PAGES[0], extra)}</li>` : ''}</ul>`;
  return `<html><head><title>Home</title></head><body><div class="nav desktop-nav">${one}</div><div id="navMobile" class="nav mobile-nav">${one}</div></body></html>`;
}
const photo = ({ file, caption, width = 400, alt = '' }) => `<div id='111-imageContainer-${file}'><div class="galleryImageHolder"><a href='/uploads/9/9/${file}_orig.jpg' rel='lightbox[gallery111]'${caption === undefined ? '' : ` title='${caption}'`}><img src='/uploads/9/9/${file}.jpg' class='galleryImage'${width === null ? '' : ` _width='${width}'`} _height='300'${alt ? ` alt='${alt}'` : ''} /></a></div></div>`;
function galleryPage({ heading = 'Lamps', title = heading, photos = [], extra = '' }) {
  const banner = heading === null ? '' : `<h2 class="wsite-content-title" style="text-align:center;">${ZERO_WIDTH}${ZERO_WIDTH}<font color="#d5d5d5">${heading}</font></h2>`;
  return `<html><head><title>${title}</title></head><body><div class="wsite-section wsite-header-section"><div class="wsite-section-elements">${banner}</div></div>
<div class="main-wrap"><div id="wsite-content" class="wsite-elements wsite-not-footer"><div id='111-gallery' class='imageGallery'>${photos.map(photo).join('\n')}</div>${extra}</div></div><div class="footer-wrap"><a href="https://host.example/?utm_source=made-up">made with</a></div></body></html>`;
}
const page = (slug, label, html) => ({ label, url: `${SITE}${slug}.html`, slug, html });
const parse = (...pages) => parseGalleries(pages, { vendor, catalog });

test('the pages to read are the menu group\'s sub-pages in order, then the extra page, each once', () => {
  assert.deepEqual(galleryPages(menu(), SITE), [
    { label: 'Lamps', url: `${SITE}lamps.html`, slug: 'lamps' },
    { label: 'seating', url: `${SITE}chairs.html`, slug: 'chairs' },
    { label: EXTRA_PAGES[0], url: `${SITE}sale-page.html`, slug: 'sale-page' },
  ]);
  for (const href of ['/lamps.html?x=1', '/lamps.html#top', 'https://other.example/lamps.html', '/lamps/', '/a/b.html']) {
    assert.throws(() => galleryPages(menu({ group: [['Lamps', href]] }), SITE), /not a page on gallery\.example; stopping before any request/, href);
  }
  assert.throws(() => galleryPages(menu({ group: [] }), SITE), /has no "Props" pages/);
  assert.throws(() => galleryPages(menu({ extra: null }), SITE), /has no "For Sale" page/);
});

test('each captioned photo becomes an item named by its caption, under the page heading, linking the page', () => {
  const parsed = parse(page('lamps', 'Lamps', galleryPage({ photos: [
    { file: 'brass', caption: 'Test brass lamp,  1950s' },
    { file: 'tin', caption: 'Tin lamp &amp; shade &#39;as is&#39; &quot;tall&quot;\n with D&eacute;co base' },
  ] })));
  const key = siteKey('gt', 'lamps|Test brass lamp, 1950s');
  assert.deepEqual(parsed.items[0], { key, vendor: 'gallery-test', catalog: 'gt-test', name: 'Test brass lamp, 1950s', description: null, categories: ['Lamps'], era: '1950s', decades: [1950], url: `${SITE}lamps.html` });
  assert.equal(parsed.items[1].name, 'Tin lamp & shade \'as is\' "tall" with Déco base');
  assert.deepEqual(parsed.images.get(key), { urls: [`${SITE}uploads/9/9/brass.jpg`] });
  assert.deepEqual(parsed.counts, { pages: 1, photos: 2, items: 2 });
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
});

test('the heading loses its zero-width spaces and tags; a page without one falls back to its title, flagged; a different menu label is flagged', () => {
  assert.deepEqual(parse(page('lamps', 'Lamps', galleryPage({ heading: 'D&eacute;cor &amp; More', photos: [{ file: 'a', caption: 'Vase' }] }))).items[0].categories, ['Décor & More']);
  const fallback = parse(page('chairs', 'seating', galleryPage({ heading: null, title: 'Chairs', photos: [{ file: 'a', caption: 'Stool' }] })));
  assert.deepEqual(fallback.items[0].categories, ['Chairs']);
  assert.ok(fallback.report.some((line) => line.includes('has no banner heading, so its <title> "Chairs" is the category')), fallback.report.join('\n'));
  assert.ok(fallback.report.some((line) => line.includes('menu label "seating", category "Chairs"')));
  const odd = parse(page('lamps', 'Lamps', galleryPage({ heading: 'Odd &zzz; heading', photos: [{ file: 'a', caption: 'Vase &qqq; one' }] })));
  assert.deepEqual(checkSiteItems(odd.items, { vendor, catalog }).map((problem) => problem.replace(/^gt-\w+: /, '')), ['name holds &qqq;, an HTML entity that was not decoded', 'category holds &zzz;, an HTML entity that was not decoded']);
  const styled = galleryPage({ heading: null, title: 'Chairs', photos: [{ file: 'a', caption: 'Stool' }] }).replace('</head>', '<style>.wsite-header-section .wsite-content-title {}</style></head>').replace('<div id="wsite-content" class="wsite-elements wsite-not-footer">', '<div id="wsite-content" class="wsite-elements wsite-not-footer"><h2 class="wsite-content-title">In the body</h2>');
  assert.deepEqual(parse(page('chairs', 'Chairs', styled)).items[0].categories, ['Chairs'], 'only a heading inside the header section counts');
});

test('untitled photos are named by page and number and keyed by their file; photos sharing a caption are one item', () => {
  const parsed = parse(page('lamps', 'Lamps', galleryPage({ photos: [
    { file: 'one', caption: '' },
    { file: 'two', caption: 'Floor lamp' },
    { file: 'three', caption: 'Floor lamp' },
    { file: 'four', alt: 'an alt text' },
    { file: 'one', caption: '' },
  ] })));
  assert.deepEqual(parsed.items.map((item) => [item.key, item.name]), [
    [siteKey('gt', 'lamps|#one_orig.jpg'), 'Lamps item 1 (no title given)'],
    [siteKey('gt', 'lamps|Floor lamp'), 'Floor lamp'],
    [siteKey('gt', 'lamps|#four_orig.jpg'), 'Lamps item 2 (no title given)'],
  ]);
  assert.deepEqual(parsed.images.get(siteKey('gt', 'lamps|Floor lamp')).urls, [`${SITE}uploads/9/9/two.jpg`, `${SITE}uploads/9/9/three.jpg`]);
  assert.deepEqual(parsed.counts, { pages: 1, photos: 5, items: 3 });
  assert.ok(parsed.report.some((line) => line.includes('(its image has alt text, which is not used)')));
  assert.ok(parsed.report.some((line) => line.endsWith('5 photos, 2 captioned, 2 untitled items')), parsed.report.join('\n'));
});

test('the same caption and photo on two pages are one item with both categories and the first page\'s link', () => {
  const parsed = parse(
    page('lamps', 'Lamps', galleryPage({ photos: [{ file: 'brass', caption: 'Brass lamp' }, { file: 'tin', caption: 'Tin lamp' }] })),
    page('office', 'At Work', galleryPage({ heading: 'At Work', photos: [{ file: 'brass', caption: 'Brass lamp' }, { file: 'other', caption: 'Tin lamp' }] })),
  );
  const brass = parsed.items.find((item) => item.name === 'Brass lamp');
  assert.deepEqual([brass.key, brass.categories, brass.url], [siteKey('gt', 'lamps|Brass lamp'), ['Lamps', 'At Work'], `${SITE}lamps.html`]);
  assert.deepEqual(parsed.items.filter((item) => item.name === 'Tin lamp').map((item) => item.categories), [['Lamps'], ['At Work']], 'a different photo is another item');
  assert.deepEqual(parsed.counts, { pages: 2, photos: 4, items: 3 });
  assert.ok(parsed.report.some((line) => line.includes(`${brass.key} "Brass lamp" is also on ${SITE}office.html with the same photo`)));
  const reuploaded = parse(
    page('lamps', 'Lamps', galleryPage({ photos: [{ file: 'cooler', caption: 'Water jug' }] })),
    page('office', 'At Work', galleryPage({ heading: 'At Work', photos: [{ file: 'cooler_1', caption: 'Water jug' }, { file: 'cooler_1', caption: 'Water jar' }] })),
  );
  assert.deepEqual(reuploaded.items.map((item) => [item.name, item.categories]), [['Water jug', ['Lamps', 'At Work']], ['Water jar', ['At Work']]], 'a second upload of the same file is the same photo; another caption is another item');
});

test('merges of both kinds are listed with their photo counts, untitled photos of one file merge across pages too, and an empty or zero-width caption is untitled', () => {
  const zeroWidth = String.fromCodePoint(0x200b);
  const parsed = parse(
    page('lamps', 'Lamps', galleryPage({ photos: [{ file: 'a', caption: 'Floor lamp' }, { file: 'b', caption: 'Floor lamp' }, { file: 'c', caption: zeroWidth }, { file: 'd', caption: ' ' }] })),
    page('office', 'At Work', galleryPage({ heading: 'At Work', photos: [{ file: 'b', caption: 'Floor lamp' }, { file: 'c' }] })),
  );
  assert.deepEqual(parsed.items.map((item) => [item.name, item.categories]), [
    ['Floor lamp', ['Lamps', 'At Work']],
    ['Lamps item 1 (no title given)', ['Lamps', 'At Work']],
    ['Lamps item 2 (no title given)', ['Lamps']],
  ]);
  const merged = parsed.report.slice(parsed.report.indexOf('Merged (one item from several photos, by page and photo count):') + 1, parsed.report.findIndex((line) => line.startsWith('Items (')));
  assert.deepEqual(merged, [
    `  ${siteKey('gt', 'lamps|Floor lamp')} "Floor lamp": 2 on Lamps, 1 on At Work`,
    `  ${siteKey('gt', 'lamps|#c_orig.jpg')} "Lamps item 1 (no title given)": 1 on Lamps, 1 on At Work`,
  ]);
});

test('a rel in double quotes counts, and a printed caption that differs from the title is flagged', () => {
  const html = galleryPage({ photos: [{ file: 'a', caption: 'Brass lamp' }, { file: 'b', caption: 'Tin lamp' }] })
    .replace("rel='lightbox[gallery111]' title='Tin lamp'", 'rel="lightbox[gallery111]" title="Tin lamp"')
    .replace('</a></div>', '</a><div class="galleryCaptionHolder"><div class="galleryCaptionInnerText">Brass lamp, pair</div></div></div>');
  const parsed = parse(page('lamps', 'Lamps', html));
  assert.deepEqual(parsed.items.map((item) => item.name), ['Brass lamp', 'Tin lamp']);
  assert.ok(parsed.report.some((line) => line.includes('printed caption "Brass lamp, pair" differs from its title "Brass lamp"; the title is used')), parsed.report.join('\n'));
});

test('a caption ending in "$N each" keeps the amount as listedPrice; any other price stops the import', () => {
  const parsed = parse(page('sale-page', EXTRA_PAGES[0], galleryPage({ heading: EXTRA_PAGES[0], photos: [{ file: 'a', caption: 'Glass jug  $12 each' }, { file: 'b', caption: 'Stone jar. $15.50 each.' }] })));
  assert.deepEqual(parsed.items.map((item) => [item.name, item.listedPrice]), [['Glass jug', '12'], ['Stone jar.', '15.50']]);
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
  for (const caption of ['Jug $12', 'Jug, $12 a day', 'Jug $ 5 each or two for $9']) {
    assert.throws(() => parse(page('sale-page', EXTRA_PAGES[0], galleryPage({ photos: [{ file: 'a', caption }] }))), /gives a price in a form this import doesn't read/, caption);
  }
  assert.throws(() => parse(page('sale-page', EXTRA_PAGES[0], galleryPage({ photos: [{ file: 'a', caption: 'Two for $35, or $20 each' }] }))), /gives a second price, which would be shown/);
});

test('a round century written as a decade gets no era and is flagged; a plain decade or year is kept', () => {
  const parsed = parse(page('lamps', 'Lamps', galleryPage({ photos: [
    { file: 'a', caption: 'Oil lamp, early 1900s' },
    { file: 'b', caption: 'Wall sconce 1800s' },
    { file: 'c', caption: 'Mid 1950s desk lamp' },
    { file: 'd', caption: 'Lantern from 1912' },
  ] })));
  assert.deepEqual(parsed.items.map((item) => [item.era, item.decades]), [[null, []], [null, []], ['1950s', [1950]], ['1912', [1910]]]);
  assert.ok(parsed.report.some((line) => line.includes('"Oil lamp, early 1900s": "1900s" may mean a century, so no era is kept')));
});

test('the photo is the thumbnail when it is at least 320 px wide, else the original; a query on a photo stops the import', () => {
  const parsed = parse(page('lamps', 'Lamps', galleryPage({ photos: [{ file: 'a', caption: 'A', width: 320 }, { file: 'b', caption: 'B', width: 300 }, { file: 'c', caption: 'C', width: null }] })));
  assert.deepEqual(parsed.items.map((item) => parsed.images.get(item.key).urls[0]), [`${SITE}uploads/9/9/a.jpg`, `${SITE}uploads/9/9/b_orig.jpg`, `${SITE}uploads/9/9/c_orig.jpg`]);
  assert.ok(parsed.report.includes('Photo variant used: thumbnail 1, original (thumbnail narrower than 320 px) 1, original (no thumbnail width) 1'), parsed.report.join('\n'));
  const queried = galleryPage({ photos: [{ file: 'a', caption: 'A' }] }).replace("a.jpg' class", "a.jpg?v=made-up' class");
  assert.throws(() => parse(page('lamps', 'Lamps', queried)), /a URL with a query \(v\)/);
});

test('the report counts images outside the galleries and text paragraphs, and flags a caption that may be another view', () => {
  const extra = '<div class="paragraph">Ask us about more lamps.</div><div class="wsite-image"><img src="/uploads/9/9/x.jpg" alt="Picture"></div>';
  const parsed = parse(page('lamps', 'Lamps', galleryPage({ photos: [{ file: 'a', caption: 'Brass lamp' }, { file: 'b', caption: 'Brass lamp side view' }, { file: 'c', caption: 'Lamps' }], extra })));
  assert.ok(parsed.report.some((line) => line.endsWith('3 photos, 3 captioned, 0 untitled items, 1 images outside galleries, 1 text paragraphs')), parsed.report.join('\n'));
  assert.ok(parsed.report.some((line) => line.includes('"Brass lamp side view" may be another view of "Brass lamp"')));
  assert.ok(parsed.report.some((line) => line.includes('"Lamps" only repeats its category')));
});

test('the import reads robots.txt, the home page and each menu page in order, and dates the snapshot by its earliest page', async () => {
  const responses = new Map([
    [`${SITE}robots.txt`, 'User-agent: *\nDisallow: /ajax/\n'],
    [SITE, menu({ group: [['Lamps', '/lamps.html'], ['seating', '/chairs.html']] })],
    [`${SITE}lamps.html`, galleryPage({ photos: [{ file: 'a', caption: 'Brass lamp' }] })],
    [`${SITE}chairs.html`, galleryPage({ heading: 'Chairs', photos: [{ file: 'b', caption: 'Oak chair' }] })],
    [`${SITE}sale-page.html`, galleryPage({ heading: EXTRA_PAGES[0], photos: [{ file: 'c', caption: 'Glass jug $12 each' }] })],
  ]);
  const requested = [];
  const fetcher = {
    get: async (url) => {
      requested.push(url);
      if (!responses.has(url)) throw new Error(`unexpected request for ${url}`);
      return { body: Buffer.from(responses.get(url)), meta: { url, status: 200, fetchedAt: url.endsWith('chairs.html') ? '2026-10-17T12:00:00.000Z' : '2026-10-18T16:00:00.000Z' }, cached: false, missing: false };
    },
    raiseGap: () => {},
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'props-gallery-'));
  const outFile = path.join(directory, 'inventory.json');
  const { items, parsed } = await importSite({ vendorId: vendor.id, vendors: { vendors: [{ ...vendor, catalogs: [catalog] }] }, outFile, cacheRoot: directory, fetcher, exclusions: {}, log: () => {}, today: () => '2026-10-18' });
  assert.deepEqual(requested, [`${SITE}robots.txt`, SITE, `${SITE}lamps.html`, `${SITE}chairs.html`, `${SITE}sale-page.html`]);
  assert.deepEqual(items.map((item) => [item.name, item.categories[0], item.listedPrice ?? null]), [['Brass lamp', 'Lamps', null], ['Oak chair', 'Chairs', null], ['Glass jug', EXTRA_PAGES[0], '12']]);
  assert.equal(parsed.capturedAt, '2026-10-17');
  const written = JSON.parse(await readFile(outFile, 'utf8'));
  assert.deepEqual(written.catalogs['gt-test'], { indexedAt: '2026-10-18', capturedAt: '2026-10-17', pages: 3, photos: 3 });
});
