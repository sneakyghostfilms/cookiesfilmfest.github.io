import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { affiliation } from '../src/scripts/props-cards.js';
import { compareByName, tokenize } from '../src/scripts/props-search.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const read = async (relative) => readFile(path.join(root, relative), 'utf8');
const vendors = JSON.parse(await read('src/data/props/vendors.json'));
const inventory = JSON.parse(await read('src/data/props/inventory.json'));
const html = await read('dist/props/index.html');
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

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }));
  return nested.flat();
}

test('/props renders one card per inventory item, alphabetically by name', () => {
  assert.equal((html.match(/<li class="prop-card"/g) ?? []).length, inventory.items.length);
  const names = [...html.matchAll(/<span class="prop-name">([^<]*)<\/span>/g)].map(([, name]) => decode(name));
  assert.deepEqual(names, names.map((name) => ({ name, key: '' })).sort(compareByName).map((entry) => entry.name));
});

test('cards follow the spec format and carry the source link and inquiry route', () => {
  assert.ok(text.includes('Steel City Props · #056 · GREEN CHANGE MACHINE · 1960s · page 5'), 'spec example line');
  assert.ok(text.includes('When you inquire, cite #056 · GREEN CHANGE MACHINE · page 5'));
  assert.ok(html.includes(`href="${catalog.sourceUrl}"`));
  assert.ok(text.includes('Open catalog on Google Drive'));
  assert.ok(!text.includes('go to page'), 'no deep-link wording: Drive ignores #page');
  assert.ok(html.includes(`href="${vendor.contact.formUrl}"`));
  assert.ok(html.includes(`href="mailto:${vendor.contact.email}"`));
  assert.ok(text.includes('AI-suggested search terms:'));
});

test('/props states what it is not and how vendors can opt out', () => {
  assert.ok(text.includes('It does not book rentals or show live availability.'));
  assert.ok(text.includes('Always confirm availability, condition, sizes and price with the vendor.'));
  assert.ok(text.includes(affiliation(vendors.vendors)));
  assert.ok(text.includes('Not affiliated with Steel City Props or Dezzign Central.'));
  assert.ok(text.includes('want your inventory listed, corrected or removed?'));
  assert.ok(html.includes('href="/#contact"'));
});

test('/props carries the festival byline and requests no fonts of its own', () => {
  assert.match(html, /<p class="props-byline"><a href="\/">A Cookies &amp; Comedy Film Festival project<\/a><\/p>/);
  assert.ok(text.includes('Back to Main Site'));
  assert.ok(!html.includes('fonts.googleapis.com'), 'the page links no font stylesheet itself');
});

test('no vendor photos or catalog PDFs are published', async () => {
  assert.ok(!/<img\b/i.test(html));
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

test('the AI scene box discloses AI processing and stays switched off until a Worker URL is configured', async () => {
  const config = JSON.parse(await read('src/data/props/config.json'));
  assert.equal(config.apiUrl, '', 'the committed site must not call the Worker until Scott approves');
  assert.ok(text.includes('Paste a scene to find props (AI)'));
  assert.ok(text.includes("Your text is sent to Cloudflare Workers AI to pick props from these catalogs. This site doesn't store or log it."));
  assert.ok(text.includes("AI scene matching isn't switched on yet. Keyword search works."));
  assert.match(html, /<form id="scene-form" class="scene-form" data-api-url(="")?>/);
  assert.match(html, /<textarea id="scene-text"[^>]*\sdisabled[\s>]/);
  assert.match(html, /<button id="scene-submit"[^>]*\sdisabled[\s>]/);
  assert.ok(text.includes('Time period or setting (optional)'));
  assert.match(html, /<input id="scene-period"[^>]*maxlength="40"[^>]*placeholder="1960s, WWII, present day"[^>]*\sdisabled[\s>]/);
});

test('scene results tell the reader that unlisted props were not identified or have no match', async () => {
  const scripts = (await filesUnder(path.join(dist, '_astro'))).filter((file) => file.endsWith('.js'));
  const sources = await Promise.all(scripts.map((file) => readFile(file, 'utf8')));
  const pageScript = sources.find((source) => source.includes('Matched by AI'));
  assert.ok(pageScript, 'the /props script is built');
  assert.ok(pageScript.includes('The AI chose from the catalog items whose words match your scene. Props not listed above were not identified or have no match among them; try keyword search for them.'));
  assert.ok(pageScript.includes('were left out of AI matching.'), 'a period filter is disclosed');
  assert.ok(!pageScript.includes('differs from your period'), 'the old era note is gone');
});

test('every card names its vendor, and the vendor filter appears only with more than one vendor', () => {
  const cardVendors = [...html.matchAll(/<li class="prop-card" data-key="[^"]+" data-vendor="([^"]+)"/g)].map(([, id]) => id);
  assert.equal(cardVendors.length, inventory.items.length);
  const withItems = vendors.vendors.filter((entry) => inventory.items.some((item) => item.vendor === entry.id));
  assert.equal(/<select id="props-vendor">/.test(html), withItems.length > 1);
});

test('vendor boxes show the published facts with their sources, and nothing private', () => {
  assert.ok(text.includes('To rent from Steel City Props: official contact form · steelcitypropsllc@gmail.com'));
  assert.ok(text.includes('Terms they publish: “We will send a quote back as soon we review your request.”'));
  assert.ok(text.includes('Prop house. Offers: rentals'));
  assert.ok(text.includes('Address: Pittsburgh, PA'));
  assert.match(text, /Details as the vendor publishes them, last checked 2026-10-17: instagram\.com\/steelcityprops · catalog page 3 · catalog page 1 · forms\.gle\/JJqcgmxkJFwqKLXF9 · linktr\.ee\/steelcityprops \./);
  assert.ok(html.includes('href="https://linktr.ee/steelcityprops"'));
  assert.ok(!text.includes('Private, local demo only'), 'relationship notes appear only in the local demo, and only with PROPS_SHOW_PRIVATE=1');
  assert.ok(text.includes('Prop pages on dezzigncentralpgh.com · captured 2026-10-17 · 23 items · indexed 2026-10-17 · Open site'));
  assert.ok(text.includes('Hours: please call or email us to schedule an appointment Pricing and terms: ask the vendor'));
  assert.ok(!/permission|not asked/i.test(text));
});

test('the page builds its search documents from the cards the same way the Worker builds them from the inventory', async () => {
  const { searchDocs } = await import('../worker/src/inventory.js');
  const tagsFile = JSON.parse(await read('src/data/props/tags.json'));
  const fromPage = new Map([...html.matchAll(/<li class="prop-card"[\s\S]*?<\/li>/g)].map(([card]) => {
    const pick = (pattern) => decode(card.match(pattern)?.[1] ?? '');
    const name = pick(/<span class="prop-name">([^<]*)<\/span>/);
    const era = pick(/<span class="prop-era">([^<]*)<\/span>/);
    const categories = pick(/data-categories="([^"]*)"/);
    return [pick(/data-key="([^"]*)"/), {
      name: tokenize(name),
      description: tokenize(`${name} ${era}`),
      categories: categories ? categories.split('|') : [],
      tags: pick(/<span class="prop-tag-list">([^<]*)<\/span>/) ? pick(/<span class="prop-tag-list">([^<]*)<\/span>/).split(', ') : [],
      decades: pick(/data-decades="([^"]*)"/) ? pick(/data-decades="([^"]*)"/).split(' ').map(Number) : [],
      vendor: pick(/data-vendor="([^"]*)"/),
    }];
  }));
  for (const doc of searchDocs(inventory.items, tagsFile.tags)) {
    assert.deepEqual(fromPage.get(doc.key), {
      name: tokenize(doc.name), description: tokenize(doc.description), categories: doc.categories, tags: doc.tags, decades: doc.decades, vendor: doc.vendor,
    }, doc.key);
  }
});
