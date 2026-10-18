import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { cardText, searchDocFromCard } from '../src/scripts/props-card-text.js';
import { NOT_AFFILIATED, vendorBadges, vendorSearchDoc } from '../src/scripts/props-cards.js';
import { compareByName, tokenize } from '../src/scripts/props-search.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const read = async (relative) => readFile(path.join(root, relative), 'utf8');
const vendors = JSON.parse(await read('src/data/props/vendors.json'));
const inventory = JSON.parse(await read('src/data/props/inventory.json'));
const html = await read('dist/props/index.html');
const sceneHtml = await read('dist/props/scene/index.html');
const cardsJson = await read('dist/props/cards.json');
const cardsData = JSON.parse(cardsJson);
const cards = cardsData.items.map((entry) => cardText(entry, cardsData));
// A page's built script: its entry module and every chunk that one imports, since the two props pages share chunks.
async function pageScriptOf(page) {
  const files = [page.match(/<script type="module" src="\/_astro\/([^"]+\.js)">/)[1]];
  const sources = [];
  for (const file of files) {
    const source = await readFile(path.join(dist, '_astro', file), 'utf8');
    sources.push(source);
    for (const [, chunk] of source.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) if (!files.includes(chunk)) files.push(chunk);
  }
  return sources.join('\n');
}
const pageScript = await pageScriptOf(html);
const sceneScript = await pageScriptOf(sceneHtml);
const vendor = vendors.vendors[0];
const catalog = vendor.catalogs[0];

function decode(text) {
  return text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function visibleText(markup) {
  return decode(markup.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ');
}

const text = visibleText(html);
const sceneText = visibleText(sceneHtml);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }));
  return nested.flat();
}

test('/props holds no card: cards.json holds one entry per inventory item, alphabetically by name, for the page to draw', () => {
  assert.doesNotMatch(html, /prop-card/);
  assert.match(html, /<ol id="props-results" class="props-results" data-cards-url="\/props\/cards\.json\?v=[0-9a-f]{8}"><\/ol>/);
  assert.equal(cards.length, inventory.items.length);
  assert.deepEqual(new Set(cards.map((card) => card.key)), new Set(inventory.items.map((item) => item.key)));
  assert.deepEqual(cards.map((card) => card.key), [...cards].sort(compareByName).map((card) => card.key));
  assert.ok(text.includes('Search needs JavaScript, and so does the item list. The prop sources below, with their contact details, are listed without it.'));
});

test("cards.json's ?v= is the first 8 hex of its sha256, and the file holds nothing that changes from build to build", () => {
  const version = html.match(/data-cards-url="\/props\/cards\.json\?v=([0-9a-f]{8})"/)[1];
  assert.equal(version, createHash('sha256').update(cardsJson).digest('hex').slice(0, 8));
  assert.doesNotMatch(cardsJson, /\d{4}-\d{2}-\d{2}T\d{2}:/, 'no timestamp');
});

test('cards follow the spec format and carry the source link and inquiry route', () => {
  const spec = cards.find((card) => card.key === 'scp-056');
  assert.deepEqual([spec.vendorName, spec.ids, spec.name, spec.era, spec.pages], ['Steel City Props', '#056', 'GREEN CHANGE MACHINE', '1960s', 'page 5'], 'spec example line');
  assert.equal(spec.cite, 'When you inquire, cite #056 · GREEN CHANGE MACHINE · page 5');
  assert.deepEqual(spec.link, { href: catalog.sourceUrl, label: 'Open catalog on Google Drive' });
  assert.equal(spec.inquire, vendor.contact.formUrl);
  assert.ok(html.includes(`href="mailto:${vendor.contact.email}"`), "the vendor box keeps the vendor's e-mail");
  assert.ok(!cardsJson.includes('go to page'), 'no deep-link wording: Drive ignores #page');
  for (const script of [pageScript, sceneScript]) assert.ok(!script.includes('AI-suggested search terms'), 'a card shows no search-terms line');
});

test("the props pages' scripts run in the browser only: no Node module or file call is bundled into them", () => {
  for (const script of [pageScript, sceneScript]) assert.doesNotMatch(script, /node:|readFileSync|existsSync/);
});

test('both props pages state what the search is not and how vendors can opt out', () => {
  for (const [page, pageText] of [[html, text], [sceneHtml, sceneText]]) {
    assert.ok(pageText.includes('It does not book rentals or show live availability.'));
    assert.ok(pageText.includes('Always confirm availability, condition, sizes and price with the vendor.'));
    assert.ok(pageText.includes(NOT_AFFILIATED));
    assert.ok(pageText.includes('want your inventory listed, corrected or removed?'));
    assert.ok(page.includes('href="/#contact"'));
  }
});

test('both props pages carry the festival byline and request no fonts of their own', () => {
  for (const [page, pageText] of [[html, text], [sceneHtml, sceneText]]) {
    assert.match(page, /<p class="props-byline"><a href="\/">A Cookies &amp; Comedy Film Festival project<\/a><\/p>/);
    assert.ok(pageText.includes('Back to Main Site'));
    assert.ok(!page.includes('fonts.googleapis.com'), 'the page links no font stylesheet itself');
  }
});

test('no vendor photos or catalog PDFs are published', async () => {
  assert.ok(!/<img\b/i.test(html));
  assert.ok(!/<img\b/i.test(sceneHtml));
  for (const card of cards) assert.deepEqual([card.thumb, card.alt, card.photoCredit], [null, null, null], card.key);
  assert.doesNotMatch(cardsJson, /props-demo|"thumb"|"alt"|listedPrice|\$\s*\d/, 'no demo field, demo path or price in the production data');
  assert.deepEqual((await filesUnder(dist)).filter((file) => file.toLowerCase().endsWith('.pdf')), []);
});

test('the existing festival pages still build', () => {
  for (const route of ['index.html', 'pa-festivals/index.html', 'comedy-festivals/index.html', 'travel/index.html',
    'past-events/2025/index.html', 'past-events/2026/index.html']) {
    assert.ok(existsSync(path.join(dist, route)), route);
  }
});

test('the main page nav links to /props from the desktop link groups and the mobile menu', async () => {
  const index = await read('dist/index.html');
  const desktop = index.slice(index.indexOf('class="header-links-section"'), index.indexOf('class="notify-container"'));
  assert.match(desktop, /<span class="link-header"[^>]*>Resources<\/span><a href="\/props"[^>]*>Prop Search<\/a>/);
  const mobileStart = index.indexOf('id="menu-modal"');
  const mobile = index.slice(mobileStart, index.indexOf('</ul>', mobileStart));
  assert.match(mobile, /data-dropdown="resources"[\s\S]*?Resources[\s\S]*?<a class="mobile-menu-link mobile-submenu-link" href="\/props"[^>]*>\s*Prop Search\s*<\/a>/);
});

test('the scene page discloses AI processing and stays switched off until a Worker URL is configured', async () => {
  const config = JSON.parse(await read('src/data/props/config.json'));
  assert.equal(config.apiUrl, '', 'the committed site must not call the Worker until the site owner approves');
  assert.ok(sceneText.includes('Paste a scene to find props (AI)'));
  assert.ok(sceneText.includes("Your text is sent to Cloudflare Workers AI to pick props from these catalogs. This site doesn't store or log it."));
  assert.ok(sceneText.includes("AI scene matching isn't switched on yet. Keyword search works."));
  assert.match(sceneHtml, /<form id="scene-form" class="scene-form" data-api-url(="")? data-cards-url="\/props\/cards\.json\?v=[0-9a-f]{8}">/);
  assert.match(sceneHtml, /<textarea id="scene-text"[^>]*\sdisabled[\s>]/);
  assert.match(sceneHtml, /<button id="scene-submit"[^>]*\sdisabled[\s>]/);
  assert.ok(sceneText.includes('Time period or setting (optional)'));
  assert.match(sceneHtml, /<input id="scene-period"[^>]*maxlength="40"[^>]*placeholder="1960s, WWII, present day"[^>]*\sdisabled[\s>]/);
});

test('the keyword page holds no scene box, and the Workers AI note sits on the scene page only', () => {
  assert.doesNotMatch(html, /id="scene-|Paste a scene to find props|Cloudflare Workers AI/);
  assert.match(sceneHtml, /Cloudflare Workers AI/);
});

test('each props page links to the other right below its search box', () => {
  assert.match(html, /<\/form><p class="props-switch"><a href="\/props\/scene">Paste a scene instead<\/a><\/p>/);
  assert.match(sceneHtml, /<\/form><p class="props-switch"><a href="\/props">Search by keyword instead<\/a><\/p>/);
});

test("the scene page shares /props's header, disclosures, opt-out line and byline, holds no item, and draws from the same cards.json", () => {
  const part = (page, start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)) + end.length);
  for (const [start, end] of [['<header class="props-header">', '</header>'], ['<section class="props-box props-about"><p>', '</p>'], ['<p class="props-footer">', '</html>']]) {
    assert.ok(sceneHtml.includes(start), start);
    assert.equal(part(sceneHtml, start, end), part(html, start, end), start);
  }
  assert.doesNotMatch(sceneHtml, /prop-card|<ol\b/);
  assert.ok(sceneHtml.includes('<noscript><p class="props-note">Scene matching needs JavaScript. The prop sources, with their contact details, are listed without it on <a href="/props#prop-sources">the keyword search page</a>.</p></noscript>'));
  assert.equal(sceneHtml.match(/data-cards-url="([^"]+)"/)[1], html.match(/data-cards-url="([^"]+)"/)[1]);
});

test('scene results tell the reader that unlisted props were not identified or have no match', () => {
  assert.ok(sceneScript.includes('The AI chose from the catalog items whose words match your scene. Props not listed above were not identified or have no match among them; try keyword search for them.'));
  assert.ok(sceneScript.includes('were left out of AI matching.'), 'a period filter is disclosed');
  assert.ok(!sceneScript.includes('differs from your period'), 'the old era note is gone');
  assert.ok(!pageScript.includes('Matched by AI'), 'the keyword page carries no scene code');
});

test('every card names its vendor, and the vendor filter appears only with more than one vendor', () => {
  const vendorOf = new Map(inventory.items.map((item) => [item.key, item.vendor]));
  for (const card of cards) assert.equal(card.vendorId, vendorOf.get(card.key), card.key);
  for (const card of cards) assert.equal(card.vendorName, vendors.vendors.find((entry) => entry.id === card.vendorId).name, card.key);
  const withItems = vendors.vendors.filter((entry) => inventory.items.some((item) => item.vendor === entry.id));
  assert.equal(/<select id="props-vendor">/.test(html), withItems.length > 1);
});

const vendorSection = (id) => html.match(new RegExp(`<section class="props-box props-vendor" id="vendor-${id}"[\\s\\S]*?</section>`))?.[0] ?? '';
const withItems = new Set(inventory.items.map((item) => item.vendor));
const byName = (a, b) => a.name.localeCompare(b.name, 'en');

test('vendor boxes show the published facts with their sources, and nothing private', () => {
  const steelCity = visibleText(vendorSection('steel-city-props'));
  assert.ok(steelCity.includes('Inquiries: official contact form · steelcitypropsllc@gmail.com'));
  assert.ok(text.includes('Terms they publish: “We will send a quote back as soon we review your request.”'));
  assert.ok(vendorSection('steel-city-props').includes('<span class="props-badge">Prop house</span><span class="props-badge">Rentals</span>'));
  assert.ok(text.includes('Address: Pittsburgh, PA'));
  assert.match(text, /Details as the vendor publishes them, last checked 2026-10-17: instagram\.com\/steelcityprops · catalog page 3 · catalog page 1 · forms\.gle\/JJqcgmxkJFwqKLXF9 · linktr\.ee\/steelcityprops \./);
  assert.ok(html.includes('href="https://linktr.ee/steelcityprops"'));
  assert.ok(!text.includes('Private, local demo only'), 'relationship notes appear only in the local demo, and only with PROPS_SHOW_PRIVATE=1');
  assert.ok(!text.includes('Private vendor notes visible'));
  assert.ok(text.includes('Prop pages on dezzigncentralpgh.com · captured 2026-10-17 · 23 items · indexed 2026-10-17 · Open site'));
  assert.ok(text.includes('Hours: please call or email us to schedule an appointment Pricing and terms: ask the vendor'));
  assert.ok(!/permission|not asked/i.test(text));
});

test('every vendor has one box with an anchor: vendors with searchable items first, each group by name', () => {
  const ids = [...html.matchAll(/<section class="props-box props-vendor" id="vendor-([^"]+)" data-vendor="\1">/g)].map(([, id]) => id);
  const expected = [...vendors.vendors.filter((entry) => withItems.has(entry.id)).sort(byName), ...vendors.vendors.filter((entry) => !withItems.has(entry.id)).sort(byName)];
  assert.deepEqual(ids, expected.map((entry) => entry.id));
  assert.ok(text.includes(`${vendors.vendors.length} prop sources are listed below with the contact details they publish; ${withItems.size} have searchable inventory.`));
  assert.ok(html.includes(`<h2 id="prop-sources" class="props-sources-title">Prop sources (${vendors.vendors.length})</h2>`));
  for (const entry of vendors.vendors.filter((one) => !withItems.has(one.id))) {
    assert.ok(visibleText(vendorSection(entry.id)).includes('Inventory not indexed; contact the vendor.'), entry.id);
  }
});

test('the vendor strip holds exactly the vendors without searchable items, hidden until a search matches their name or own words', () => {
  const strip = html.match(/<section id="props-vendor-matches" class="vendor-matches" hidden>[\s\S]*?<\/section>/)?.[0];
  assert.ok(strip, 'the strip is built and starts hidden');
  assert.ok(visibleText(strip).includes('Prop sources that match this search; inventory not indexed'));
  assert.doesNotMatch(visibleText(strip), /speciali[sz]e/i, 'a name-only match makes no specialty claim');
  const cards = [...strip.matchAll(/<li class="vendor-match" data-vendor="([^"]+)" data-name="([^"]*)" data-specialties(?:="([^"]*)")? hidden>/g)];
  const expected = vendors.vendors.filter((entry) => !withItems.has(entry.id)).sort(byName);
  assert.deepEqual(cards.map(([, id]) => id), expected.map((entry) => entry.id));
  for (const [[, id, name, specialties], entry] of cards.map((card, order) => [card, expected[order]])) {
    const doc = vendorSearchDoc(entry, 0);
    assert.deepEqual([decode(name), decode(specialties ?? '')], [doc.name, doc.description], id);
  }
});

test('regional badges mark only the sources outside Pennsylvania', () => {
  const regional = vendors.vendors.filter((entry) => vendorBadges(entry).some((badge) => badge.regional)).map((entry) => entry.id);
  assert.deepEqual(regional.sort(), ['cleveland-play-house-props', 'cleveland-prop-shop']);
  for (const id of regional) assert.ok(vendorSection(id).includes('<span class="props-badge props-badge-regional">Regional: Cleveland, OH</span>'), id);
});

test('Route 30 Retro shows only its Facebook Page facts, cited as read, with no type of our own', () => {
  const box = vendorSection('route-30-retro');
  assert.ok(visibleText(box).includes('Route 30 Retro Facebook Page (About), as read on 2026-10-17 · not fetched by our scripts'));
  assert.ok(box.includes('href="https://www.facebook.com/p/Route-30-Retro-100063856903288"'));
  assert.deepEqual([...box.matchAll(/<span class="props-badge">([^<]*)<\/span>/g)].map(([, label]) => label), ['Sales']);
});

test('the page builds its search documents from cards.json the same way the Worker builds them from the inventory', async () => {
  const { searchDocs } = await import('../worker/src/inventory.js');
  const tagsFile = JSON.parse(await read('src/data/props/tags.json'));
  const fromPage = new Map(cards.map((card) => {
    const doc = searchDocFromCard(card);
    return [doc.key, { name: tokenize(doc.name), description: tokenize(doc.description), categories: doc.categories, tags: doc.tags, decades: doc.decades, vendor: doc.vendor, order: doc.order }];
  }));
  const workerDocs = searchDocs(inventory.items, tagsFile.tags);
  assert.equal(fromPage.size, workerDocs.length);
  for (const doc of workerDocs) {
    assert.deepEqual(fromPage.get(doc.key), {
      name: tokenize(doc.name), description: tokenize(doc.description), categories: doc.categories, tags: doc.tags, decades: doc.decades, vendor: doc.vendor, order: doc.order,
    }, doc.key);
  }
});
