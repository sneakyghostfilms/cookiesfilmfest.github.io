#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, VENDORS_FILE, extractCatalog, findCatalog, sha256 } from './catalog-pdf.mjs';
import { pdfBox, readDemoManifest } from './demo-links.mjs';
import { CACHE_ROOT, findSiteCatalog, loadSite } from './import-site.mjs';
import { buildItems, cardIdentity, identityOf } from './normalize.mjs';
import { privateOutputProblem } from './private-output.mjs';
import { robotsRules, robotsStopReason } from './robots.mjs';
import { createSiteFetcher } from './site-fetch.mjs';
import { IMAGE_HOST as SHOPIFY_IMAGE_HOST } from './sites/retro-on-8th.mjs';

export { privateOutputProblem };

export const DEMO_DIR = join(ROOT, '.props-demo');
const CROPPER = join(ROOT, 'scripts/props/crop_thumbs.py');
const DEMO_PORT = 4321;
const DEMO_API_URL = 'https://pgh-prop-search.sdanzig.workers.dev';
const THUMB_WIDTH = 320;

export function photoUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname === SHOPIFY_IMAGE_HOST) parsed.searchParams.set('width', '640');
  return parsed.href;
}

export function photoHostFor(catalog) {
  if (catalog.photoHost) return catalog.photoHost;
  return catalog.type === 'shopify-export' ? SHOPIFY_IMAGE_HOST : new URL(catalog.siteUrl).hostname;
}

export function mergeManifest(previous, catalogId, catalogEntry, entries) {
  return {
    schemaVersion: 1,
    catalogs: { ...previous?.catalogs, [catalogId]: catalogEntry },
    items: Object.fromEntries([...Object.entries(previous?.items ?? {}).filter(([, entry]) => entry.catalog !== catalogId), ...entries]),
  };
}

export function demoEnv(env) {
  return { ...env, PROPS_DEMO: '1', PUBLIC_PROPS_API_URL: env.PUBLIC_PROPS_API_URL || DEMO_API_URL };
}

export function demoWarnings(env, vendors, manifest) {
  const warnings = [];
  for (const vendor of vendors.vendors) {
    for (const catalog of vendor.catalogs) {
      if (catalog.type !== 'pdf' && !manifest?.catalogs?.[catalog.id]) {
        warnings.push(`No local photos for ${vendor.name}; its cards show without them. To add them: npm run props:demo-assets -- --vendor ${vendor.id}`);
      }
    }
  }
  if (env.PROPS_SHOW_PRIVATE === '1') warnings.push('PROPS_SHOW_PRIVATE=1 is set: private vendor notes are visible on the page. Do not screenshare it.');
  return warnings;
}

function assertPrivate(directory) {
  const problem = privateOutputProblem(directory);
  if (problem) throw new Error(`Refusing to write vendor photos: ${problem}`);
}

async function buildAssets(pdfPath) {
  const thumbs = join(DEMO_DIR, 'thumbs');
  const catalogs = join(DEMO_DIR, 'catalogs');
  for (const directory of [DEMO_DIR, thumbs, catalogs]) assertPrivate(directory);
  const vendors = JSON.parse(await readFile(VENDORS_FILE, 'utf8'));
  const digest = await sha256(pdfPath);
  const match = findCatalog(vendors, digest);
  if (!match) throw new Error(`The PDF's sha256 (${digest}) matches no catalog in src/data/props/vendors.json.`);
  const { catalog } = match;
  console.log(`Building local demo assets for ${catalog.id}…`);
  const extraction = extractCatalog(pdfPath);
  const firstCards = new Map();
  for (const card of extraction.cards) if (!firstCards.has(cardIdentity(card))) firstCards.set(cardIdentity(card), card);
  const cards = new Map(buildItems(extraction, match).map((item) => [item.key, firstCards.get(identityOf(item))]));
  await mkdir(thumbs, { recursive: true });
  await mkdir(catalogs, { recursive: true });
  const planFile = join(DEMO_DIR, 'crop-plan.json');
  await writeFile(planFile, JSON.stringify(Object.fromEntries([...cards].map(([key, card]) => [key, { page: card.page, box: card.box }]))));
  const run = spawnSync('python3', ['-I', '-B', CROPPER, pdfPath, planFile, thumbs], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  await rm(planFile, { force: true });
  if (run.status !== 0) throw new Error(`Cropping failed (exit ${run.status}):\n${run.stderr}`);
  const sizes = JSON.parse(run.stdout);
  await copyFile(pdfPath, join(catalogs, `${catalog.id}.pdf`));
  const items = [...cards].map(([key, card]) => [key, {
    catalog: catalog.id,
    page: card.page,
    box: pdfBox(card.box, card.pageHeight),
    thumb: { width: sizes[key][0], height: sizes[key][1] },
  }]);
  const manifest = mergeManifest(readDemoManifest(DEMO_DIR), catalog.id, { sha256: digest }, items);
  await writeFile(join(DEMO_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`✅ ${items.length} thumbnails, the catalog PDF and manifest.json are in .props-demo/`);
}

async function buildSiteAssets(vendorId, exportPath) {
  const vendors = JSON.parse(await readFile(VENDORS_FILE, 'utf8'));
  const { vendor, catalog } = findSiteCatalog(vendors, vendorId);
  const thumbs = join(DEMO_DIR, 'thumbs');
  const originals = join(DEMO_DIR, 'originals', vendor.id);
  for (const directory of [DEMO_DIR, thumbs, originals]) assertPrivate(directory);
  const cachedOnly = createSiteFetcher({
    allowHosts: [new URL(catalog.sourceUrl ?? catalog.siteUrl).hostname],
    fetch: () => {
      throw new Error(`not in the local cache; run npm run props:import-site -- --vendor ${vendor.id} first`);
    },
  });
  const { items, images } = await loadSite({ vendor, catalog, cacheRoot: CACHE_ROOT, fetcher: cachedOnly, exportPath });
  const photoHost = photoHostFor(catalog);
  const fetcher = createSiteFetcher({ allowHosts: [photoHost] });
  const robots = await fetcher.get(`https://${photoHost}/robots.txt`, originals, { missingOk: true });
  const rules = robotsRules(robots.missing ? '' : robots.body.toString('utf8'));
  const firstPhotos = items.map((item) => images.get(item.key)?.urls[0]).filter(Boolean).map(photoUrl);
  const stopReason = robotsStopReason(rules, firstPhotos, photoHost);
  if (stopReason) throw new Error(stopReason);
  if (rules.crawlDelaySeconds) fetcher.raiseGap(rules.crawlDelaySeconds * 1000);
  console.log(`robots.txt on ${photoHost}: ${robots.missing ? `unavailable, so no rules (HTTP ${robots.meta.status})` : `${rules.group ? `group ${rules.group}, ` : 'no group for us, '}${rules.disallow.length} Disallow prefixes, Crawl-delay ${rules.crawlDelaySeconds ?? 'none'}`}`);
  const { default: sharp } = await import('sharp');
  await mkdir(thumbs, { recursive: true });
  const entries = [];
  for (const item of items) {
    const [image] = images.get(item.key)?.urls ?? [];
    if (!image) continue;
    const { body } = await fetcher.get(photoUrl(image), originals);
    const { data, info } = await sharp(body).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    await writeFile(join(thumbs, `${item.key}.webp`), data);
    entries.push([item.key, { catalog: catalog.id, thumb: { width: info.width, height: info.height }, image }]);
  }
  const manifest = mergeManifest(readDemoManifest(DEMO_DIR), catalog.id, { type: catalog.type, photos: entries.length }, entries);
  await writeFile(join(DEMO_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  const photos = [...images.values()].reduce((sum, entry) => sum + entry.urls.length, 0);
  const { requests, cacheHits } = fetcher.stats();
  console.log(`✅ ${entries.length} thumbnails for ${vendor.name} in .props-demo/thumbs (${requests} downloaded, ${cacheHits} from the local copy). ${photos - entries.length} more photos on their pages were not fetched; ${items.length - entries.length} items have no photo.`);
}

async function hasAssets(catalog) {
  const copy = join(DEMO_DIR, 'catalogs', `${catalog.id}.pdf`);
  return existsSync(copy) && readDemoManifest(DEMO_DIR)?.catalogs?.[catalog.id]?.sha256 === catalog.sha256 && (await sha256(copy)) === catalog.sha256;
}

function assertPortFree(port) {
  return Promise.all(['127.0.0.1', '::1'].map((host) => new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', (error) => (error.code === 'EADDRINUSE'
      ? reject(new Error(`Port ${port} is in use. Stop whatever is running there first: the Worker only answers http://localhost:${port}.`))
      : done()));
    probe.listen(port, host, () => probe.close(done));
  })));
}

async function serve(pdfPath) {
  const vendors = JSON.parse(await readFile(VENDORS_FILE, 'utf8'));
  const supplied = pdfPath ? await sha256(pdfPath) : null;
  for (const catalog of vendors.vendors.flatMap((vendor) => vendor.catalogs).filter((entry) => entry.type === 'pdf')) {
    if (await hasAssets(catalog)) continue;
    if (supplied !== catalog.sha256) {
      throw new Error(`No local demo assets for "${catalog.title}". Run: npm run props:demo -- --pdf "/path/to/that catalog.pdf"`);
    }
    await buildAssets(pdfPath);
  }
  for (const warning of demoWarnings(process.env, vendors, readDemoManifest(DEMO_DIR))) console.warn(`⚠️  ${warning}`);
  await assertPortFree(DEMO_PORT);
  const child = spawn('npx', ['astro', 'dev', '--port', String(DEMO_PORT)], { cwd: ROOT, stdio: 'inherit', env: demoEnv(process.env) });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, options: { pdf: { type: 'string' }, vendor: { type: 'string' }, export: { type: 'string' } } });
  const pdf = values.pdf && resolve(values.pdf);
  if (pdf && !existsSync(pdf)) throw new Error(`No such file: ${pdf}`);
  if (mode === 'assets' && pdf) return buildAssets(pdf);
  if (mode === 'assets' && values.vendor) return buildSiteAssets(values.vendor, values.export && resolve(values.export));
  if (mode === 'serve') return serve(pdf);
  throw new Error('Usage: npm run props:demo [-- --pdf "<catalog.pdf>"]  or  npm run props:demo-assets -- --pdf "<catalog.pdf>"  or  npm run props:demo-assets -- --vendor <id> [--export "<file.csv>"]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}
