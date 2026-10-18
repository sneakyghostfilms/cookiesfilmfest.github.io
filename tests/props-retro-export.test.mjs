import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseCsv } from '../scripts/props/csv.mjs';
import { importSite } from '../scripts/props/import-site.mjs';
import { siteKey } from '../scripts/props/site-items.mjs';
import { COLUMNS, parseExport, resolveColumns, titleEra } from '../scripts/props/sites/retro-on-8th.mjs';
import { tagPayload } from '../scripts/props/tags.mjs';
import { listing } from '../worker/src/inventory.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = (layout) => path.join(root, `tests/fixtures/props-shopify-export-${layout}.csv`);
const current = await readFile(fixture('current'), 'utf8');
const legacy = await readFile(fixture('legacy'), 'utf8');
const vendor = { id: 'retro-on-8th', name: 'Retro on 8th', keyPrefix: 'ro8' };
const catalog = { id: 'ro8-test', type: 'shopify-export', siteUrl: 'https://retroon8th.com/products/', capturedAt: '2026-10-17' };
const parsed = parseExport(current, { vendor, catalog });
const byName = new Map(parsed.items.map((item) => [item.name, item]));
const PRIVATE = /SENTINEL|424242/;

function rewrite(csvText, change) {
  const [header, ...rows] = parseCsv(csvText);
  const result = change(header, rows);
  const cell = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return result.map((row) => row.map(cell).join(',')).join('\r\n');
}

async function exportCopy(text, name = 'products_export.csv') {
  const directory = await mkdtemp(path.join(tmpdir(), 'props-export-'));
  const file = path.join(directory, name);
  await writeFile(file, text);
  return { file, sha256: createHash('sha256').update(text).digest('hex'), directory };
}

test('the CSV reader follows RFC 4180: BOM, CRLF, quoted commas, doubled quotes and line breaks', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n1,"x, y"\r\n2,"say ""hi"""\n3,"two\nlines"\n'), [['a', 'b'], ['1', 'x, y'], ['2', 'say "hi"'], ['3', 'two\nlines']]);
  assert.deepEqual(parseCsv('a,b\n1,""\n'), [['a', 'b'], ['1', '']]);
  assert.throws(() => parseCsv('a,b\n1,x"y\n'), /quote inside an unquoted field/);
  assert.throws(() => parseCsv('a,b\n1,"open\n'), /never closed/);
  assert.throws(() => parseCsv('a,b\n1,"x"y\n'), /after a closing quote/);
});

test('current and legacy Shopify exports of the same products give identical items', () => {
  const old = parseExport(legacy, { vendor, catalog });
  assert.deepEqual(old.items, parsed.items);
  assert.deepEqual(old.counts, parsed.counts);
  assert.deepEqual([...old.images], [...parsed.images]);
  assert.deepEqual(parsed.items.map((item) => item.name), [
    "Vintage 1960's Rotary Phone", '1950s–70s Desk Fan', 'Metal TV Tray', 'Set of 4 Mod Glasses', 'The Riverboat 1938',
    "Vintage '57 Bel Air Telephone", 'Space Age Set of 6 Mod Cups', "Vintage 60's/70's Lamp", '1950s-70s Barware',
  ]);
});

test('each logical column resolves from either header name, and only from one', () => {
  assert.throws(() => resolveColumns(['Title', 'Type', 'Tags']), /no "URL handle" or "Handle" column/);
  const both = rewrite(current, (header, rows) => [[...header, 'Handle'], ...rows.map((row) => [...row, ''])]);
  assert.throws(() => parseExport(both, { vendor, catalog }), /both "URL handle" and "Handle"/);
  assert.throws(() => resolveColumns(['Title', 'Title']), /"Title" twice/);
  const single = Object.entries(COLUMNS).filter(([, names]) => names.length === 1).map(([column]) => column);
  assert.deepEqual(single, ['title', 'type', 'tags', 'status'], 'single-name columns can never count as "both"');
});

test('continuation rows may repeat product values, but never contradict them or come back later', () => {
  assert.ok(byName.has('Set of 4 Mod Glasses'), 'its variant row repeats Title and Type identically');
  const conflicting = rewrite(current, (header, rows) => {
    const at = rows.findIndex((row, index) => index > 0 && row[1] === 'test-two-variant-glasses');
    rows[at][header.indexOf('Type')] = 'Barware';
    return [header, ...rows];
  });
  assert.throws(() => parseExport(conflicting, { vendor, catalog }), /later row of "test-two-variant-glasses" gives a different type/);
  const reappearing = rewrite(current, (header, rows) => [header, ...rows, rows[0]]);
  assert.throws(() => parseExport(reappearing, { vendor, catalog }), /"test-rotary-phone" appears again/);
  const handleless = rewrite(current, (header, rows) => { rows[0][1] = ''; return [header, ...rows]; });
  assert.throws(() => parseExport(handleless, { vendor, catalog }), /has no handle/);
  for (const handle of ['../x', 'lamp/brass', 'lamp?x=1', 'lamp brass']) {
    const odd = rewrite(current, (header, rows) => {
      for (const row of rows) if (row[1] === 'test-rotary-phone') row[1] = handle;
      return [header, ...rows];
    });
    assert.throws(() => parseExport(odd, { vendor, catalog }), /handles hold only letters, numbers and dashes/, handle);
  }
});

test('exclusions are counted per reason, and the sold-out rule reads variant rows only', () => {
  assert.deepEqual(parsed.counts, {
    products: 16,
    items: 9,
    excluded: { 'not active': 2, 'not published': 1, 'marked sold': 2, 'sold out': 1, 'gift card': 1 },
  });
  assert.ok(!byName.has('Transistor Radio'), 'one tracked variant at 0 with deny, plus two image-only rows, is sold out');
  assert.ok(byName.has('1950s–70s Desk Fan'), 'a blank quantity is unknown, not zero');
  assert.ok(byName.has('Metal TV Tray'), 'continue selling keeps it');
  assert.ok(byName.has('The Riverboat 1938'), 'untracked stock is never sold out');
  assert.ok(byName.has('Set of 4 Mod Glasses'), 'one variant still in stock keeps it');
  const noStock = rewrite(current, (header, rows) => {
    const keep = header.map((name, index) => (['Inventory tracker', 'Inventory quantity', 'Continue selling when out of stock'].includes(name) ? -1 : index)).filter((index) => index >= 0);
    return [header, ...rows].map((row) => keep.map((index) => row[index] ?? ''));
  });
  const skipped = parseExport(noStock, { vendor, catalog });
  assert.equal(skipped.counts.excluded['sold out'], 0);
  assert.ok(skipped.items.some((item) => item.name === 'Transistor Radio'));
  assert.match(skipped.report.join('\n'), /Sold-out rule skipped/);
});

test('items map the vendor fields: Type and Tags as categories, an era from the title, the first price and image', () => {
  const phone = byName.get("Vintage 1960's Rotary Phone");
  assert.deepEqual(phone, {
    key: siteKey('ro8', 'test-rotary-phone'), vendor: 'retro-on-8th', catalog: 'ro8-test', name: "Vintage 1960's Rotary Phone", description: null,
    categories: ['Electronics', 'Phones', 'Mid Century'], era: "1960's", decades: [1960], url: 'https://retroon8th.com/products/test-rotary-phone', listedPrice: '45.00',
  });
  assert.equal(phone.key, 'ro8-tl0ui5');
  assert.deepEqual(byName.get('Space Age Set of 6 Mod Cups').categories, []);
  assert.equal(byName.get('Set of 4 Mod Glasses').listedPrice, '12.00');
  assert.deepEqual(parsed.images.get(byName.get('Set of 4 Mod Glasses').key).urls, ['https://cdn.shopify.com/s/files/1/0000/0000/0001/products/glasses-1.jpg']);
  assert.match(parsed.report.join('\n'), /First images not on cdn\.shopify\.com, which stop the demo's photo download: 1/);
  const eras = {
    "Vintage '57 Bel Air Telephone": null, 'Space Age Set of 6 Mod Cups': null, 'The Riverboat 1938': '1938', "Vintage 60's/70's Lamp": "60's/70's",
    '1950s-70s Barware': '1950s-70s', '1950s–70s Desk Fan': '1950s–70s', "'50s Diner Sign": "'50s", 'Pocket R70 Radio': null, 'Game Console 2600': null,
    'Vintage 45s Record Case': null, "Record Carry Case 45's": null, 'Box of 78s': null, 'Set of 12s': null, 'Size 10s Boots': null, 'Lot of 33s': null,
    '1910s Parlor Chair': '1910s', 'Late 1890s Trunk': '1890s',
  };
  for (const [title, era] of Object.entries(eras)) assert.equal(titleEra(title), era, title);
  assert.deepEqual(byName.get('1950s–70s Desk Fan').decades, [1950, 1960, 1970]);
});

test('private export columns never reach the inventory, the report, the tag payload, the Worker listing or the photo list', async () => {
  const { file, sha256 } = await exportCopy(current);
  const outFile = path.join(path.dirname(file), 'inventory.json');
  const lines = [];
  const vendors = { vendors: [{ ...vendor, catalogs: [{ ...catalog, sha256 }] }] };
  const { parsed: imported } = await importSite({ vendorId: vendor.id, vendors, exportPath: file, outFile, log: (line) => lines.push(line), today: () => '2026-10-17' });
  assert.match(current, PRIVATE, 'the fixture carries the sentinels');
  assert.doesNotMatch(JSON.stringify(imported.items), PRIVATE);
  assert.doesNotMatch(await readFile(outFile, 'utf8'), PRIVATE);
  assert.doesNotMatch(lines.join('\n'), PRIVATE);
  assert.doesNotMatch(JSON.stringify(tagPayload(imported.items)), PRIVATE);
  assert.doesNotMatch(listing(imported.items), PRIVATE);
  assert.doesNotMatch(JSON.stringify([...imported.images]), PRIVATE);
});

test('the Retro import never touches the network', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the Retro import must not fetch'); };
  try {
    const { file, sha256 } = await exportCopy(legacy);
    const vendors = { vendors: [{ ...vendor, catalogs: [{ ...catalog, sha256 }] }] };
    const result = await importSite({ vendorId: vendor.id, vendors, exportPath: file, outFile: path.join(path.dirname(file), 'inventory.json'), log: () => {} });
    assert.equal(result.items.length, 9);
  } finally {
    globalThis.fetch = realFetch;
  }
  for (const module of ['scripts/props/sites/retro-on-8th.mjs', 'scripts/props/csv.mjs']) {
    const source = await readFile(path.join(root, module), 'utf8');
    assert.doesNotMatch(source, /site-fetch|node:https?|node:net|undici|\bfetch\(/, module);
  }
});

test('the import refuses an export inside the repository, a changed export, a missing date and unlistable text', async () => {
  const vendors = (extra) => ({ vendors: [{ ...vendor, catalogs: [{ ...catalog, ...extra }] }] });
  const { file, sha256 } = await exportCopy(current);
  const outFile = path.join(path.dirname(file), 'inventory.json');
  await assert.rejects(importSite({ vendorId: vendor.id, vendors: vendors({ sha256 }), exportPath: fixture('current'), outFile, log: () => {} }), /inside the repository and git does not ignore it/);
  await assert.rejects(importSite({ vendorId: vendor.id, vendors: vendors({ sha256: '0'.repeat(64) }), exportPath: file, outFile, log: () => {} }), /does not match ro8-test/);
  await assert.rejects(importSite({ vendorId: vendor.id, vendors: vendors({ sha256, capturedAt: undefined }), exportPath: file, outFile, log: () => {} }), /needs "capturedAt"/);
  await assert.rejects(importSite({ vendorId: vendor.id, vendors: vendors({ sha256 }), outFile, log: () => {} }), /pass --export/);
  const piped = await exportCopy(rewrite(current, (header, rows) => { rows[0][0] = 'Rotary Phone | Black'; return [header, ...rows]; }));
  await assert.rejects(importSite({ vendorId: vendor.id, vendors: vendors({ sha256: piped.sha256 }), exportPath: piped.file, outFile, log: () => {} }), /would break a listing line/);
});
