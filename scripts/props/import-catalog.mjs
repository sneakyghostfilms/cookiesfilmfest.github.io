#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, VENDORS_FILE, extractCatalog, findCatalog, sha256 } from './catalog-pdf.mjs';
import { buildItems, checkItems, replaceCatalog, serializeInventory } from './normalize.mjs';

const INVENTORY_FILE = join(ROOT, 'src/data/props/inventory.json');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function structuralProblems(extraction) {
  const { checks } = extraction;
  const problems = [];
  if (checks.framedIdTokens !== checks.idTokens) {
    problems.push(`${checks.idTokens} item numbers on the pages but ${checks.framedIdTokens} inside photo frames`);
  }
  if (checks.cardsWithoutPill) problems.push(`${checks.cardsWithoutPill} photo frames have no caption pill`);
  if (checks.orphanPills) problems.push(`${checks.orphanPills} caption pills have no photo frame`);
  return problems;
}

function report(extraction, items, catalog, pages) {
  const cards = extraction.cards;
  const itemPages = [...new Set(cards.map((card) => card.page))].sort((a, b) => a - b);
  const sectionPages = new Map(extraction.sections.map((section) => [section.page, section.title]));
  const considered = pages ?? Array.from({ length: extraction.pageCount }, (_, index) => index + 1);
  const skipped = considered.filter((page) => !itemPages.includes(page))
    .map((page) => (sectionPages.has(page) ? `${page} (divider: ${sectionPages.get(page)})` : `${page} (no item cards)`));
  const owners = new Map();
  for (const item of items) for (const number of item.itemNumbers) owners.set(number, (owners.get(number) ?? 0) + 1);
  const reused = [...owners].filter(([, count]) => count > 1).map(([number]) => number).sort();
  const lines = [
    `Catalog: ${catalog.title} (version ${catalog.version}, ${extraction.pageCount} pages)`,
    `Pages read: ${considered.length}; pages with items: ${itemPages.length} [${itemPages.join(', ')}]`,
    `Pages skipped: ${skipped.join('; ') || 'none'}`,
    `Cards: ${cards.length}; item numbers on pages: ${extraction.checks.idTokens}; inside frames: ${extraction.checks.framedIdTokens}`,
    `Distinct items: ${items.length}; merged duplicate cards: ${cards.length - items.length}`,
    `Item numbers reused for different captions: ${reused.join(', ') || 'none'}`,
    `Multi-number cards: ${items.filter((item) => item.itemNumbers.length > 1).map((item) => item.printedIds.join(' ')).join('; ') || 'none'}`,
    `Malformed printed IDs: ${cards.flatMap((card) => card.printedIds).filter((id) => !/^\[\d{3}\]$/.test(id)).join(', ') || 'none'}`,
    `Bare numbers read as item numbers (top of a photo frame): ${extraction.checks.bareFramedIds.join(', ') || 'none'}`,
    `Caption lines dropped as off-centre (badge text): ${cards.filter((card) => card.droppedLines.length).map((card) => `p${card.page} ${card.printedIds.join(' ')} "${card.droppedLines.join(' / ')}"`).join('; ') || 'none'}`,
    `Cards without a photo: ${extraction.checks.cardsWithoutImage}`,
    `Items with a stated era: ${items.filter((item) => item.era).length}; without: ${items.filter((item) => !item.era).length}`,
  ];
  if (catalog.expected) {
    const actual = { cards: cards.length, items: items.length, itemPages: itemPages.length };
    const mismatched = Object.entries(catalog.expected).filter(([key, value]) => actual[key] !== value);
    lines.push(mismatched.length
      ? `⚠️  Counts differ from vendors.json "expected": ${mismatched.map(([key, value]) => `${key} ${actual[key]} (expected ${value})`).join(', ')}. Review, then update "expected".`
      : 'Counts match vendors.json "expected".');
  }
  console.log(lines.join('\n'));
  return itemPages;
}

async function main() {
  const { values } = parseArgs({
    options: { pdf: { type: 'string' }, pages: { type: 'string' }, out: { type: 'string' }, 'sheets-dir': { type: 'string' } },
  });
  if (!values.pdf) fail('Usage: npm run props:import -- --pdf "<catalog.pdf>" [--pages 5,20] [--out file] [--sheets-dir dir]');
  const pdf = resolve(values.pdf);
  if (!existsSync(pdf)) fail(`No such file: ${pdf}`);
  const vendors = JSON.parse(await readFile(VENDORS_FILE, 'utf8'));
  const digest = await sha256(pdf);
  const match = findCatalog(vendors, digest);
  if (!match) fail(`The PDF's sha256 (${digest}) matches no catalog in src/data/props/vendors.json. Add or update that catalog entry first.`);
  const { vendor, catalog } = match;
  const pages = values.pages ? values.pages.split(',').map(Number) : null;
  const extraction = extractCatalog(pdf, { pages: values.pages, sheetsDir: values['sheets-dir'] && resolve(values['sheets-dir']) });
  const items = buildItems(extraction, { vendor, catalog });
  const itemPages = report(extraction, items, catalog, pages);
  const problems = [
    ...structuralProblems(extraction),
    ...checkItems(items, { pageCount: extraction.pageCount, sectionTitles: extraction.sections.map((section) => section.title) }),
  ];
  if (problems.length) fail(`Not writing the inventory:\n- ${problems.join('\n- ')}`);
  if (pages && !values.out) {
    console.log('Partial run: nothing written (pass --out to write).');
    return;
  }
  const outFile = values.out ? resolve(values.out) : INVENTORY_FILE;
  const existing = existsSync(outFile) ? JSON.parse(await readFile(outFile, 'utf8')) : { schemaVersion: 1, catalogs: {}, items: [] };
  const previousItems = existing.items.filter((item) => item.catalog === catalog.id);
  const unchanged = JSON.stringify(previousItems) === JSON.stringify(items);
  const indexedAt = unchanged && existing.catalogs[catalog.id] ? existing.catalogs[catalog.id].indexedAt : new Date().toLocaleDateString('en-CA');
  const inventory = replaceCatalog(existing, {
    catalogId: catalog.id,
    items,
    entry: { indexedAt, cards: extraction.cards.length, itemPages, sections: extraction.sections },
    listedCatalogIds: new Set(vendors.vendors.flatMap((entry) => entry.catalogs.map((listed) => listed.id))),
  });
  const keys = inventory.items.map((item) => item.key);
  const repeated = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (repeated.length) fail(`Not writing the inventory: these keys appear in more than one listed catalog: ${repeated.join(', ')}`);
  await writeFile(outFile, serializeInventory(inventory), 'utf8');
  console.log(`✅ Wrote ${items.length} items to ${outFile}${unchanged ? ' (unchanged)' : ''}`);
}

main().catch((error) => fail(error.stack ?? String(error)));
