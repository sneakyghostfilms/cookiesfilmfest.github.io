#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, VENDORS_FILE, sha256 } from './catalog-pdf.mjs';
import { replaceCatalog, serializeInventory } from './normalize.mjs';
import { exportLocationProblem } from './private-output.mjs';
import { robotsAllow, robotsRules, robotsTarget } from './robots.mjs';
import { FetchStopped, createSiteFetcher } from './site-fetch.mjs';
import { checkSiteItems } from './site-items.mjs';
import { LISTING_PAGE_LIMIT, nextListingPage, parseListing } from './sites/construction-junction.mjs';
import { nextSubcategoryPage, parseCatalog, subcategoryPages } from './sites/bespoke-event-rentals.mjs';
import { galleryPages, parseGalleries } from './sites/cleveland-prop-shop.mjs';
import { parseCollection } from './sites/clicksburgh-retro-rentals.mjs';
import { parseStore, storeListPage, storePageCount } from './sites/creative-reuse.mjs';
import { parsePages } from './sites/dezzign-central.mjs';
import { parseExport } from './sites/retro-on-8th.mjs';
import { parseCollections } from './sites/vintage-alley.mjs';

const INVENTORY_FILE = join(ROOT, 'src/data/props/inventory.json');
export const CACHE_ROOT = join(ROOT, '.props-cache');
const ITEM_EXCLUSIONS_FILE = join(ROOT, 'scripts/props/item-exclusions.json');
export const ITEM_EXCLUSION_REASONS = new Set(["name or photo carries a private individual's name"]);
const SITE_TYPES = new Set(['wordpress-pages', 'duda-gallery', 'shopify-export', 'square-store', 'woocommerce-listing', 'weebly-gallery', 'wix-repeater', 'tapgoods-catalog']);
const WORDPRESS_PAGE_SIZE = 10;

const localDate = (moment) => new Date(moment).toLocaleDateString('en-CA');

export async function robotsCheckedFetcher(fetcher, siteUrl, directory) {
  const host = new URL(siteUrl).hostname;
  const robots = await fetcher.get(`https://${host}/robots.txt`, directory, { missingOk: true });
  const rules = robotsRules(robots.missing ? '' : robots.body.toString('utf8'));
  if (rules.unsupported.length) {
    throw new FetchStopped(`robots.txt on ${host} has rules this tool can't apply with certainty (${rules.unsupported.join('; ')}); stopping before any page`, { reason: 'robots' });
  }
  if (rules.crawlDelaySeconds) fetcher.raiseGap(rules.crawlDelaySeconds * 1000);
  return {
    rules,
    async get(url, dir, options) {
      if (!robotsAllow(rules, robotsTarget(url))) throw new FetchStopped(`robots.txt on ${host} disallows ${url}; not requesting it`, { url, reason: 'robots' });
      return fetcher.get(url, dir, options);
    },
  };
}

const SOURCES = {
  async 'wordpress-pages'({ vendor, catalog, fetcher, cacheRoot }) {
    const pageFetcher = fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] });
    const { body, meta } = await pageFetcher.get(catalog.sourceUrl, join(cacheRoot, vendor.id, catalog.id));
    const pages = JSON.parse(body.toString('utf8'));
    const perPage = Number(new URL(catalog.sourceUrl).searchParams.get('per_page') ?? WORDPRESS_PAGE_SIZE);
    if (Array.isArray(pages) && pages.length >= perPage) throw new Error(`The answer is a full page of ${perPage}; there may be more pages than one request returns.`);
    return { ...parsePages(pages, { vendor, catalog }), capturedAt: localDate(meta.fetchedAt) };
  },
  async 'duda-gallery'({ vendor, catalog, fetcher, cacheRoot }) {
    const pageFetcher = fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] });
    const { body, meta } = await pageFetcher.get(catalog.sourceUrl, join(cacheRoot, vendor.id, catalog.id));
    return { ...parseCollections(body.toString('utf8'), { vendor, catalog }), capturedAt: localDate(meta.fetchedAt) };
  },
  async 'square-store'({ vendor, catalog, fetcher, cacheRoot }) {
    const directory = join(cacheRoot, vendor.id, catalog.id);
    const site = await robotsCheckedFetcher(fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] }), catalog.sourceUrl, directory);
    const categoryPage = (await site.get(catalog.sourceUrl, directory)).body.toString('utf8');
    const listings = [];
    let firstFetchedAt;
    for (let page = 1, pages = 1; page <= pages; page += 1) {
      const { body, meta } = await site.get(storeListPage(catalog, page), directory);
      const listing = JSON.parse(body.toString('utf8'));
      if (page === 1) {
        pages = storePageCount(listing);
        firstFetchedAt = meta.fetchedAt;
      }
      listings.push(listing);
    }
    return { ...parseStore(categoryPage, listings, { vendor, catalog }), capturedAt: localDate(firstFetchedAt) };
  },
  async 'woocommerce-listing'({ vendor, catalog, fetcher, cacheRoot }) {
    const directory = join(cacheRoot, vendor.id, catalog.id);
    const site = await robotsCheckedFetcher(fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] }), catalog.sourceUrl, directory);
    const pages = [];
    let firstFetchedAt;
    for (let url = catalog.sourceUrl; url; url = nextListingPage(pages.at(-1), catalog.sourceUrl, pages.length)) {
      if (pages.length === LISTING_PAGE_LIMIT) throw new Error(`The listing goes on past ${LISTING_PAGE_LIMIT} pages; stopping before page ${LISTING_PAGE_LIMIT + 1}.`);
      const { body, meta } = await site.get(url, directory);
      firstFetchedAt ??= meta.fetchedAt;
      pages.push(body.toString('utf8'));
    }
    return { ...parseListing(pages, { vendor, catalog }), capturedAt: localDate(firstFetchedAt) };
  },
  async 'weebly-gallery'({ vendor, catalog, fetcher, cacheRoot }) {
    const directory = join(cacheRoot, vendor.id, catalog.id);
    const site = await robotsCheckedFetcher(fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] }), catalog.sourceUrl, directory);
    const home = (await site.get(catalog.sourceUrl, directory)).body.toString('utf8');
    const pages = [];
    for (const page of galleryPages(home, catalog.siteUrl)) {
      const { body, meta } = await site.get(page.url, directory);
      pages.push({ ...page, html: body.toString('utf8'), fetchedAt: meta.fetchedAt });
    }
    // The capture date is the earliest gallery page's, since a snapshot can mix pages seeded earlier with fresh ones.
    const capturedAt = localDate(Math.min(...pages.map((page) => Date.parse(page.fetchedAt))));
    return { ...parseGalleries(pages, { vendor, catalog }), capturedAt };
  },
  async 'wix-repeater'({ vendor, catalog, fetcher, cacheRoot }) {
    const directory = join(cacheRoot, vendor.id, catalog.id);
    const site = await robotsCheckedFetcher(fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] }), catalog.sourceUrl, directory);
    const { body, meta } = await site.get(catalog.sourceUrl, directory);
    return { ...parseCollection(body.toString('utf8'), { vendor, catalog }), capturedAt: localDate(meta.fetchedAt) };
  },
  async 'tapgoods-catalog'({ vendor, catalog, fetcher, cacheRoot }) {
    const directory = join(cacheRoot, vendor.id, catalog.id);
    const site = await robotsCheckedFetcher(fetcher ?? createSiteFetcher({ allowHosts: [new URL(catalog.sourceUrl).hostname] }), catalog.sourceUrl, directory);
    const collection = (await site.get(catalog.sourceUrl, directory)).body.toString('utf8');
    const pages = [];
    for (const subcategory of subcategoryPages(collection, catalog)) {
      for (let url = subcategory.url, number = 1; url; number += 1) {
        const { body, meta } = await site.get(url, directory);
        const html = body.toString('utf8');
        pages.push({ url, html, fetchedAt: meta.fetchedAt, subcategory: subcategory.url, number });
        url = nextSubcategoryPage(html, subcategory.url, number);
      }
    }
    // The capture date is the earliest page's, since a snapshot can mix pages seeded earlier with fresh ones.
    const capturedAt = localDate(Math.min(...pages.map((page) => Date.parse(page.fetchedAt))));
    return { ...parseCatalog({ collection, pages }, { vendor, catalog }), capturedAt };
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

export function withholdItems(parsed, exclusions, keyPrefix) {
  const withheld = new Set(parsed.items.map((item) => item.key).filter((key) => Object.hasOwn(exclusions, key)));
  const stale = Object.keys(exclusions).filter((key) => key.startsWith(`${keyPrefix}-`) && !parsed.items.some((item) => item.key === key));
  return {
    ...parsed,
    items: parsed.items.filter((item) => !withheld.has(item.key)),
    images: new Map([...parsed.images].filter(([key]) => !withheld.has(key))),
    counts: withheld.size ? { ...parsed.counts, items: parsed.counts.items - withheld.size, withheld: withheld.size } : parsed.counts,
    report: [...parsed.report, `Withheld by scripts/props/item-exclusions.json: ${withheld.size}${stale.length ? `; ${stale.length} listed for this vendor are not in this snapshot (sold or renamed)` : ''}`],
  };
}

export async function loadSite({ vendor, catalog, cacheRoot = CACHE_ROOT, fetcher, exportPath, exclusions }) {
  const parsed = await SOURCES[catalog.type]({ vendor, catalog, cacheRoot, fetcher, exportPath });
  return withholdItems(parsed, exclusions ?? JSON.parse(await readFile(ITEM_EXCLUSIONS_FILE, 'utf8')), vendor.keyPrefix);
}

export function findSiteCatalog(vendors, vendorId) {
  const vendor = vendors.vendors.find((entry) => entry.id === vendorId);
  if (!vendor) throw new Error(`No vendor "${vendorId}" in src/data/props/vendors.json.`);
  const catalogs = vendor.catalogs.filter((catalog) => SITE_TYPES.has(catalog.type));
  if (catalogs.length !== 1) throw new Error(`${vendor.name} needs exactly one website catalog in vendors.json; it has ${catalogs.length}.`);
  return { vendor, catalog: catalogs[0] };
}

export async function importSite({ vendorId, vendors, outFile = INVENTORY_FILE, cacheRoot = CACHE_ROOT, fetcher, exportPath, exclusions, log = console.log, today = () => localDate(Date.now()) }) {
  const { vendor, catalog } = findSiteCatalog(vendors, vendorId);
  const parsed = await loadSite({ vendor, catalog, cacheRoot, fetcher, exportPath, exclusions });
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
