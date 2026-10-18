#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, VENDORS_FILE, sha256 } from './catalog-pdf.mjs';
import { replaceCatalog, serializeInventory } from './normalize.mjs';
import { exportLocationProblem } from './private-output.mjs';
import { createSiteFetcher } from './site-fetch.mjs';
import { checkSiteItems } from './site-items.mjs';
import { parsePages } from './sites/dezzign-central.mjs';
import { parseExport } from './sites/retro-on-8th.mjs';

const INVENTORY_FILE = join(ROOT, 'src/data/props/inventory.json');
export const CACHE_ROOT = join(ROOT, '.props-cache');
export const SITE_TYPES = new Set(['wordpress-pages', 'shopify-export']);
const WORDPRESS_PAGE_SIZE = 10;

export const localDate = (moment) => new Date(moment).toLocaleDateString('en-CA');

const SOURCES = {
  async 'wordpress-pages'({ vendor, catalog, fetcher, cacheRoot }) {
    const pageFetcher = fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] });
    const { body, meta } = await pageFetcher.get(catalog.sourceUrl, join(cacheRoot, vendor.id, catalog.id));
    const pages = JSON.parse(body.toString('utf8'));
    const perPage = Number(new URL(catalog.sourceUrl).searchParams.get('per_page') ?? WORDPRESS_PAGE_SIZE);
    if (Array.isArray(pages) && pages.length >= perPage) throw new Error(`The answer is a full page of ${perPage}; there may be more pages than one request returns.`);
    return { ...parsePages(pages, { vendor, catalog }), capturedAt: localDate(meta.fetchedAt) };
  },
  async 'shopify-export'({ catalog, vendor, exportPath }) {
    if (!exportPath) throw new Error(`${vendor.name} is imported from the vendor's Shopify product export: pass --export "<file.csv>".`);
    const misplaced = exportLocationProblem(exportPath);
    if (misplaced) throw new Error(misplaced);
    if (!existsSync(exportPath)) throw new Error(`No such file: ${exportPath}`);
    const digest = await sha256(exportPath);
    if (digest !== catalog.sha256) throw new Error(`The export's sha256 (${digest}) does not match ${catalog.id} in vendors.json.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.capturedAt ?? '')) throw new Error(`${catalog.id} needs "capturedAt", the date of the export, in vendors.json.`);
    return { ...parseExport(await readFile(exportPath, 'utf8'), { vendor, catalog }), capturedAt: catalog.capturedAt };
  },
};

export function findSiteCatalog(vendors, vendorId) {
  const vendor = vendors.vendors.find((entry) => entry.id === vendorId);
  if (!vendor) throw new Error(`No vendor "${vendorId}" in src/data/props/vendors.json.`);
  const catalogs = vendor.catalogs.filter((catalog) => SITE_TYPES.has(catalog.type));
  if (catalogs.length !== 1) throw new Error(`${vendor.name} needs exactly one website catalog in vendors.json; it has ${catalogs.length}.`);
  return { vendor, catalog: catalogs[0] };
}

export async function importSite({ vendorId, vendors, outFile = INVENTORY_FILE, cacheRoot = CACHE_ROOT, fetcher, exportPath, log = console.log, today = () => localDate(Date.now()) }) {
  const { vendor, catalog } = findSiteCatalog(vendors, vendorId);
  const parsed = await SOURCES[catalog.type]({ vendor, catalog, cacheRoot, fetcher, exportPath });
  const { items, counts, report, capturedAt } = parsed;
  log([`${vendor.name} · ${catalog.id} (captured ${capturedAt})`, ...report].join('\n'));
  const actual = { ...counts };
  const mismatched = Object.entries(catalog.expected ?? {}).filter(([name, value]) => JSON.stringify(actual[name]) !== JSON.stringify(value));
  log(!catalog.expected ? 'No "expected" counts in vendors.json yet.' : mismatched.length
    ? `⚠️  Counts differ from vendors.json "expected": ${mismatched.map(([name, value]) => `${name} ${JSON.stringify(actual[name])} (expected ${JSON.stringify(value)})`).join(', ')}. Review, then update "expected".`
    : 'Counts match vendors.json "expected".');
  const problems = checkSiteItems(items, { vendor, catalog });
  if (problems.length) throw new Error(`Not writing the inventory:\n- ${problems.join('\n- ')}`);
  const existing = existsSync(outFile) ? JSON.parse(await readFile(outFile, 'utf8')) : { schemaVersion: 1, catalogs: {}, items: [] };
  const unchanged = JSON.stringify(existing.items.filter((item) => item.catalog === catalog.id)) === JSON.stringify(items);
  const indexedAt = unchanged && existing.catalogs[catalog.id] ? existing.catalogs[catalog.id].indexedAt : today();
  const { items: _items, ...entryCounts } = counts;
  const inventory = replaceCatalog(existing, {
    catalogId: catalog.id,
    items,
    entry: { indexedAt, capturedAt, ...entryCounts },
    listedCatalogIds: new Set(vendors.vendors.flatMap((entry) => entry.catalogs.map((listed) => listed.id))),
  });
  const keys = inventory.items.map((item) => item.key);
  const repeated = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (repeated.length) throw new Error(`Not writing the inventory: these keys appear in more than one listed catalog: ${repeated.join(', ')}`);
  await writeFile(outFile, serializeInventory(inventory), 'utf8');
  log(`✅ Wrote ${items.length} items to ${outFile}${unchanged ? ' (unchanged)' : ''}`);
  return { items, parsed, outFile };
}

async function main() {
  const { values } = parseArgs({ options: { vendor: { type: 'string' }, export: { type: 'string' }, out: { type: 'string' } } });
  if (!values.vendor) throw new Error('Usage: npm run props:import-site -- --vendor <vendor id> [--export "<file.csv>"] [--out file]');
  const vendors = JSON.parse(await readFile(VENDORS_FILE, 'utf8'));
  await importSite({
    vendorId: values.vendor,
    vendors,
    ...(values.export ? { exportPath: resolve(values.export) } : {}),
    ...(values.out ? { outFile: resolve(values.out) } : {}),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}
