import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSite } from '../scripts/props/import-site.mjs';
import { checkSiteItems, siteKey } from '../scripts/props/site-items.mjs';
import { SECTIONS, parseCollection } from '../scripts/props/sites/clicksburgh-retro-rentals.mjs';

const SITE = 'https://rentals.example/';
const vendor = { id: 'repeater-test', name: 'Test Rentals', keyPrefix: 'rt' };
const catalog = { id: 'rt-test', type: 'wix-repeater', sourceUrl: `${SITE}collection`, siteUrl: SITE, itemLinkLabel: 'Open collection page', photoHost: 'media.example' };
const sections = new Map([['Our Things', 'title'], ['Lamps', 'kept'], ['Chairs', 'kept'], ['Hosted Booths', 'service'], ['Bundles', 'package'], ['Plates', 'kept']]);
const ZERO_WIDTH = String.fromCodePoint(0x200b);

const mediaUrl = (id, width, host = 'media.example') => `https://${host}/media/${id}~mv2.jpg/v1/crop/x_0,y_4,w_900,h_900/fill/w_${width},h_${width},al_c,q_80,enc_avif,quality_auto/${id}.jpg`;
const richText = (id, inner, tag = 'p') => `<div id="${id}" class="N8MGzv comp-${id} wixui-rich-text" data-testid="richTextElement"><${tag} class="font_8 wixui-rich-text__text">${inner}</${tag}></div>`;
let counter = 0;
function tile({ name, price, width = 215, media = `m${(counter += 1)}`, host }) {
  const item = `item-${media}`;
  const image = `<div id="comp-img__${item}" class="Xo9D9r comp-img__${item} wixui-image"><div data-testid="linkElement"><img sizes="215px" srcSet="${mediaUrl(media, width, host)} 1x, ${mediaUrl(media, width * 2, host)} 2x" src="${mediaUrl(media, width, host)}" alt="made-up alt"/></div></div>`;
  const texts = [name === undefined ? '' : richText(`comp-name__${item}`, `<span class="wixui-rich-text__text"><span style="font-weight:bold;">${name}</span></span>`), price ? richText(`comp-price__${item}`, `<span>${price}</span>`) : ''].join('');
  return `<div role="listitem"><div id="comp-tile__${item}" class="comp-tile comp-tile__${item} FDI5TK wixui-repeater__item"><div data-testid="inline-content">${image}${texts}</div></div></div>`;
}
const repeater = (tiles) => `<div id="comp-rep${(counter += 1)}" class=" comp-rep wixui-repeater"><div role="list">${tiles.join('')}</div></div>`;
const heading = (text, tag = 'h4') => richText(`comp-h${(counter += 1)}`, `<span>${text}</span>`, tag);
const description = (text) => richText(`comp-d${(counter += 1)}`, `<span>${text}</span>`);
const page = (content, title = 'Our Things') => `<html><body><header>${heading('Lamps')}<a href="/collection">${title}</a></header><main id="PAGES_CONTAINER">${heading(title, 'h1')}${description('Welcome to the collection of things you can rent from us for your events, shoots and parties; ask us for anything you do not see here, and we will find it for you.')}${content}</main><footer>${heading('Somewhere, Pennsylvania', 'h2')}</footer></body></html>`;
const parse = (html, options = { sections }) => parseCollection(html, { vendor, catalog }, options);

test('kept tiles become items named as shown, under their section, linking the page; services and packages are counted out', () => {
  const html = page([
    heading('Lamps'), description('Our lamps light any scene, from a quiet desk in a study to a grand ballroom; each is cleaned, tested and wired for safe use before it leaves the shop.'),
    repeater([tile({ name: 'Brass Desk Lamp', price: '$40' }), tile({ name: '<span>Tin</span><span>, Glass &amp; Shade Lamp</span>', price: 'Inquire for pricing.' })]),
    heading('Hosted Booths'), repeater([tile({ name: 'Snapshot Booth', price: '$600' }), tile({ price: '$500' })]),
    heading('Bundles'), repeater([tile({ name: 'Party Bundle' })]),
    heading('Chairs'), repeater([tile({ name: 'Oak Chair with attendant', price: '$300' }), tile({ name: 'Red Velvet Chair 1950s', width: 332 })]),
  ].join(''));
  const parsed = parse(html);
  assert.deepEqual(parsed.items.map((item) => [item.key, item.name, item.categories, item.era]), [
    [siteKey('rt', 'Lamps|Brass Desk Lamp'), 'Brass Desk Lamp', ['Lamps'], null],
    [siteKey('rt', 'Lamps|Tin, Glass & Shade Lamp'), 'Tin, Glass & Shade Lamp', ['Lamps'], null],
    [siteKey('rt', 'Chairs|Red Velvet Chair 1950s'), 'Red Velvet Chair 1950s', ['Chairs'], '1950s'],
  ]);
  assert.deepEqual(parsed.counts, { tiles: 7, items: 3, excluded: { service: 3, package: 1 } });
  assert.deepEqual(parsed.items[0], { key: parsed.items[0].key, vendor: 'repeater-test', catalog: 'rt-test', name: 'Brass Desk Lamp', description: null, categories: ['Lamps'], era: null, decades: [], url: `${SITE}collection` });
  assert.ok(!('listedPrice' in parsed.items[0]), 'no price is kept');
  assert.deepEqual(checkSiteItems(parsed.items, { vendor, catalog }), []);
  assert.ok(parsed.report.includes('  Chairs (kept): 2 tiles, 1 kept'), parsed.report.join('\n'));
  const reviewed = parse(html, { sections, serviceTiles: new Set(['Brass Desk Lamp']) });
  assert.deepEqual(reviewed.counts.excluded, { service: 4, package: 1 }, 'a tile the photo review names is a service');
});

test('photos: the smallest variant at least 320 px wide, else the widest; off the photo host is flagged; a query stops', () => {
  const parsed = parse(page(`${heading('Lamps')}${repeater([tile({ name: 'A', width: 215, media: 'a' }), tile({ name: 'B', width: 332, media: 'b' }), tile({ name: 'C', width: 120, media: 'c' }), tile({ name: 'D', media: 'd', host: 'other.example' })])}`));
  assert.deepEqual(parsed.items.map((item) => parsed.images.get(item.key).urls[0]), [mediaUrl('a', 430), mediaUrl('b', 332), mediaUrl('c', 240), mediaUrl('d', 430, 'other.example')]);
  assert.ok(parsed.report.some((line) => line.includes('"D"\'s photo is not on media.example')));
  const queried = page(`${heading('Lamps')}${repeater([tile({ name: 'A', media: 'q' })])}`).replaceAll('/q.jpg', '/q.jpg?made-up=1');
  assert.throws(() => parse(queried), /a URL with a query \(made-up\)/);
});

test('tiles of one name in a section are one item; the same name in two sections stays two; an unnamed kept tile is named by section', () => {
  const parsed = parse(page([
    heading('Plates'), repeater([tile({ name: 'Tea Tub', media: 't1' }), tile({ name: 'Tea Tub', media: 't2' }), tile({ media: 'u1', price: '$5' })]),
    heading('Lamps'), repeater([tile({ name: 'Tea Tub', media: 't3' })]),
  ].join('')));
  assert.deepEqual(parsed.items.map((item) => [item.name, item.categories[0], parsed.images.get(item.key).urls.length]), [['Tea Tub', 'Plates', 2], ['Plates item 1 (no title given)', 'Plates', 1], ['Tea Tub', 'Lamps', 1]]);
  assert.equal(parsed.items[1].key, siteKey('rt', 'Plates|#u1~mv2.jpg'));
  assert.ok(parsed.report.some((line) => line.includes('"Tea Tub": 2 tiles of that name in Plates, one item')));
  assert.ok(parsed.report.some((line) => line.includes('"Tea Tub" is also a tile in Lamps; kept in each')));
});

test('only headings inside <main> count: an unknown one stops, an empty one is skipped, and a tile before any section stops', () => {
  const parsed = parse(page(`${richText('comp-zw', `<span>${ZERO_WIDTH}</span>`)}${heading('Lamps')}${repeater([tile({ name: 'A' })])}`));
  assert.equal(parsed.items.length, 1, 'the header and footer texts and a zero-width paragraph are no headings');
  assert.throws(() => parse(page(`${heading('Brand New Things')}${repeater([tile({ name: 'A' })])}`)), /a section heading this import doesn't know, "Brand New Things"/);
  assert.throws(() => parse(page(repeater([tile({ name: 'A' })]))), /comes before the first section heading/);
  assert.throws(() => parse('<html><body><p>Nothing here</p></body></html>'), /no <main> content/);
});

test('the import reads robots.txt, honouring a rule that starts with *, then the collection page', async () => {
  // The import uses the parser's own section table, so the page takes its title and first kept section from it.
  const title = [...SECTIONS].find(([, kind]) => kind === 'title')[0];
  const kept = [...SECTIONS].find(([, kind]) => kind === 'kept')[0];
  const responses = new Map([
    [`${SITE}robots.txt`, 'User-agent: *\nAllow: /\nDisallow: *?lightbox=\n'],
    [`${SITE}collection`, page(`${heading(kept)}${repeater([tile({ name: 'Brass Desk Lamp' })])}`, title)],
  ]);
  const requested = [];
  const fetcher = {
    get: async (url) => {
      requested.push(url);
      return { body: Buffer.from(responses.get(url)), meta: { url, status: 200, fetchedAt: '2026-10-17T22:00:00.000Z' }, cached: false, missing: false };
    },
    raiseGap: () => {},
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'props-repeater-'));
  const { items, parsed } = await importSite({ vendorId: vendor.id, vendors: { vendors: [{ ...vendor, catalogs: [catalog] }] }, outFile: path.join(directory, 'inventory.json'), cacheRoot: directory, fetcher, exclusions: {}, log: () => {}, today: () => '2026-10-18' });
  assert.deepEqual(requested, [`${SITE}robots.txt`, `${SITE}collection`]);
  assert.deepEqual(items.map((item) => item.name), ['Brass Desk Lamp']);
  assert.equal(parsed.capturedAt, '2026-10-17');
});
