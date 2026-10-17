import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')));
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
  assert.ok(text.includes(`Not affiliated with ${vendor.name}.`));
  assert.ok(text.includes('want your inventory listed, corrected or removed?'));
  assert.ok(html.includes('href="/#contact"'));
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
  assert.ok(text.includes("Your text is sent to Cloudflare Workers AI to pick props from this catalog. This site doesn't store or log it."));
  assert.ok(text.includes("AI scene matching isn't switched on yet. Keyword search works."));
  assert.match(html, /<form id="scene-form" class="scene-form" data-api-url(="")?>/);
  assert.match(html, /<textarea id="scene-text"[^>]*\sdisabled[\s>]/);
  assert.match(html, /<button id="scene-submit"[^>]*\sdisabled[\s>]/);
});
