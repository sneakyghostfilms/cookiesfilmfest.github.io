import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { demoCatalogHref, pdfBox, privateVendorsFor, readPrivateVendors } from '../scripts/props/demo-links.mjs';
import { privateFacts } from '../src/scripts/props-cards.js';
import { DEMO_EXCLUDED_KEYS, demoAssetHandler, propsDemo } from '../scripts/props/demo-server.mjs';
import { demoEnv, demoWarnings, mergeManifest, photoUrl, privateOutputProblem } from '../scripts/props/demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

test('demo assets may only be written to a git-ignored folder outside public/ and src/', () => {
  assert.equal(privateOutputProblem('.props-demo'), null);
  assert.equal(privateOutputProblem('.props-demo/thumbs'), null);
  assert.match(privateOutputProblem('public/props/local/thumbs'), /under public\//);
  assert.match(privateOutputProblem('src/data/props/thumbs'), /under src\//);
  assert.match(privateOutputProblem('scripts/props/thumbs'), /git does not ignore/);
  assert.match(privateOutputProblem(path.join(tmpdir(), 'thumbs')), /outside the repository/);
});

test('the Python cropper refuses the same folders before it loads pdfplumber or Pillow', async () => {
  for (const [directory, reason] of [['public/props/thumbs', /under public\//], ['src/thumbs', /under src\//], ['scripts/props/thumbs', /git does not ignore/]]) {
    const run = spawnSync('python3', ['-I', '-B', 'scripts/props/crop_thumbs.py', 'missing.pdf', 'missing.json', directory], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 1, directory);
    assert.match(run.stderr, reason, directory);
  }
  const source = await readFile(path.join(root, 'scripts/props/crop_thumbs.py'), 'utf8');
  assert.ok(source.indexOf('private_output_problem(out_dir)') < source.indexOf('import pdfplumber'), 'the guard runs before the heavy imports');
  assert.doesNotMatch(source, /^(import|from) (pdfplumber|PIL)/m, 'no top-level pdfplumber or Pillow import');
});

const SITE_WEBP = ['public/assets/accessibility/open-captions-example.webp', 'public/assets/sponsors/pct-logo.webp'];

test('no vendor photo or catalog PDF is tracked, and the demo folder is ignored', () => {
  const tracked = git('ls-files').stdout.split('\n');
  assert.deepEqual(tracked.filter((file) => /\.pdf$/i.test(file)), []);
  assert.deepEqual(tracked.filter((file) => /\.webp$/i.test(file)), SITE_WEBP, 'only the site\'s own WebP images are tracked');
  assert.equal(git('ls-files', '.props-demo').stdout, '');
  for (const file of ['.props-demo/thumbs/scp-056.webp', '.props-demo/catalogs/scp-2026-09-30.pdf', '.props-demo/manifest.json']) {
    assert.equal(git('check-ignore', '-q', file).status, 0, file);
  }
});

const TRACKED_CSV = ['comedy-festival-map.csv', 'festinfo.csv', 'tests/fixtures/props-shopify-export-current.csv', 'tests/fixtures/props-shopify-export-legacy.csv'];
const TRACKED_HTML = ['tests/fixtures/props-vintage-alley.html'];

test('raw vendor responses stay in the ignored cache, and only known CSV files are tracked', () => {
  assert.equal(git('ls-files', '.props-cache').stdout, '');
  assert.equal(git('ls-files', '.props-private').stdout, '');
  assert.equal(git('check-ignore', '-q', '.props-private/vendors.json').status, 0, '.props-private/vendors.json');
  for (const file of ['.props-cache/dezzign-central/dz-2026-10-17/0123456789abcdef.body', '.props-demo/originals/dezzign-central/0123456789abcdef.body']) {
    assert.equal(git('check-ignore', '-q', file).status, 0, file);
  }
  const tracked = git('ls-files').stdout.split('\n');
  assert.deepEqual(tracked.filter((file) => /\.csv$/i.test(file) && !TRACKED_CSV.includes(file)), [], 'a vendor export or other CSV is tracked');
  assert.deepEqual(tracked.filter((file) => /\.html?$/i.test(file) && !TRACKED_HTML.includes(file)), [], 'a vendor HTML page is tracked');
});

class Response extends Writable {
  headers = {};
  body = '';
  setHeader(name, value) {
    this.headers[name] = value;
  }
  _write(chunk, encoding, done) {
    this.body += chunk;
    done();
  }
}

test('the demo asset route serves only thumbnails and PDFs inside the demo folder', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'props-demo-'));
  await mkdir(path.join(directory, 'thumbs'));
  await writeFile(path.join(directory, 'thumbs', 'scp-056.webp'), 'webp bytes');
  await writeFile(path.join(directory, 'catalog.pdf'), 'pdf bytes');
  await writeFile(path.join(directory, 'manifest.json'), '{}');
  const handler = demoAssetHandler(directory);
  const request = (url) => new Promise((resolve) => {
    const response = new Response();
    response.on('finish', () => resolve({ type: response.headers['content-type'], body: response.body }));
    handler({ url }, response, () => resolve('next'));
  });
  assert.deepEqual(await request('/thumbs/scp-056.webp'), { type: 'image/webp', body: 'webp bytes' });
  assert.deepEqual(await request('/catalog.pdf'), { type: 'application/pdf', body: 'pdf bytes' });
  for (const url of ['/manifest.json', '/thumbs/missing.webp', '/%2e%2e/escape.webp', '/thumbs/..%2f..%2fescape.pdf', '/%E0%A4%A']) {
    assert.equal(await request(url), 'next', url);
  }
});

test('photos listed in demo-exclusions.json are never thumbnailed or served, and each has a reason', async () => {
  const exclusions = JSON.parse(await readFile(path.join(root, 'scripts/props/demo-exclusions.json'), 'utf8'));
  const inventoryKeys = new Set(JSON.parse(await readFile(path.join(root, 'src/data/props/inventory.json'), 'utf8')).items.map((item) => item.key));
  for (const [key, { reason }] of Object.entries(exclusions)) {
    assert.ok(inventoryKeys.has(key), `${key} is an inventory item`);
    assert.match(reason, /\S/, key);
  }
  assert.deepEqual([...DEMO_EXCLUDED_KEYS].sort(), Object.keys(exclusions).sort());
  const directory = await mkdtemp(path.join(tmpdir(), 'props-demo-'));
  await mkdir(path.join(directory, 'thumbs'));
  const [excluded] = DEMO_EXCLUDED_KEYS;
  for (const key of [excluded, 'scp-056']) await writeFile(path.join(directory, 'thumbs', `${key}.webp`), 'webp bytes');
  const handler = demoAssetHandler(directory);
  const request = (url) => new Promise((resolve) => {
    const response = new Response();
    response.on('finish', () => resolve('served'));
    handler({ url }, response, () => resolve('next'));
  });
  assert.equal(await request(`/thumbs/${excluded}.webp`), 'next', 'an excluded thumbnail is not served even if the file exists');
  assert.equal(await request('/thumbs/scp-056.webp'), 'served');
  const { demoPhotoItems } = await import('../scripts/props/demo.mjs');
  assert.deepEqual(demoPhotoItems([{ key: excluded }, { key: 'scp-056' }]).map((item) => item.key), ['scp-056'], 'the photo download skips excluded items before any request');
});

test('PROPS_DEMO=1 adds the asset route to dev only and makes astro build refuse to run', () => {
  const updates = [];
  const setup = (env, command) => propsDemo('/tmp/props-demo', env).hooks['astro:config:setup']({ command, updateConfig: (update) => updates.push(update) });
  assert.throws(() => setup({ PROPS_DEMO: '1' }, 'build'), /PROPS_DEMO=1 is for the local demo/);
  setup({}, 'dev');
  setup({}, 'build');
  setup({ PROPS_DEMO: '1' }, 'preview');
  assert.equal(updates.length, 0);
  setup({ PROPS_DEMO: '1' }, 'dev');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].vite.server.strictPort, true);
  assert.equal(updates[0].devToolbar.enabled, false, 'no Astro toolbar over the pitch');
  assert.equal(updates[0].vite.plugins[0].name, 'props-demo-assets');
});

test('catalog links open the local PDF at the item page, zoomed to its photo', () => {
  const box = pdfBox([13.75, 1.2, 154.02, 141.47], 842.25);
  assert.deepEqual(box, { left: 13.75, top: 841.05, right: 154.02, bottom: 700.78 });
  assert.equal(demoCatalogHref({ catalog: 'scp-2026-09-30', page: 5, box }), '/props-demo/catalogs/scp-2026-09-30.pdf#page=5&zoom=150,1,854');
});

test('private vendor notes are read only from the ignored folder, and only for the local demo', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'props-private-'));
  assert.equal(readPrivateVendors(directory), null);
  await writeFile(path.join(directory, 'vendors.json'), JSON.stringify({ 'steel-city-props': { notes: 'n' } }));
  assert.deepEqual(readPrivateVendors(directory), { 'steel-city-props': { notes: 'n' } });
  const page = await readFile(path.join(root, 'src/pages/props.astro'), 'utf8');
  assert.match(page, /const privateVendors = privateVendorsFor\(process\.env\);/);
  assert.doesNotMatch(page, /readPrivateVendors/, 'the page reads private notes only through privateVendorsFor');
});

test('private notes need both the demo and PROPS_SHOW_PRIVATE=1, which npm run props:demo never sets', async () => {
  const SENTINEL = { 'steel-city-props': { permissions: { listing: 'declined', photos: 'asked', asOf: '2026-10-17' }, notes: 'SENTINEL-PRIVATE-NOTE' } };
  let reads = 0;
  const read = () => {
    reads += 1;
    return SENTINEL;
  };
  for (const env of [{}, { PROPS_DEMO: '1' }, { PROPS_SHOW_PRIVATE: '1' }, { PROPS_DEMO: '1', PROPS_SHOW_PRIVATE: 'true' }]) {
    const shown = privateFacts(privateVendorsFor(env, read)?.['steel-city-props']);
    assert.doesNotMatch(JSON.stringify(shown), /SENTINEL|declined/, JSON.stringify(env));
  }
  assert.equal(reads, 0, 'the private file is not even read');
  const shown = privateFacts(privateVendorsFor({ PROPS_DEMO: '1', PROPS_SHOW_PRIVATE: '1' }, read)['steel-city-props']);
  assert.deepEqual(shown, ['Listing permission: declined; photo permission: asked (as of 2026-10-17)', 'Notes: SENTINEL-PRIVATE-NOTE']);
  assert.equal(demoEnv({}).PROPS_SHOW_PRIVATE, undefined, 'npm run props:demo never sets the flag');
  assert.equal(demoEnv({}).PROPS_DEMO, '1');
});

test('website photos are fetched at a modest size where the CDN offers one, and the manifest keeps each catalog apart', () => {
  assert.equal(photoUrl('https://cdn.shopify.com/s/files/1/0000/products/lamp.jpg?v=1'), 'https://cdn.shopify.com/s/files/1/0000/products/lamp.jpg?v=1&width=640');
  assert.equal(photoUrl('https://dezzigncentralpgh.com/wp-content/uploads/2015/02/chair.jpg'), 'https://dezzigncentralpgh.com/wp-content/uploads/2015/02/chair.jpg');
  const previous = {
    schemaVersion: 1,
    catalogs: { 'scp-2026-09-30': { sha256: 'x' }, 'dz-old': { type: 'wordpress-pages', photos: 1 } },
    items: { 'scp-056': { catalog: 'scp-2026-09-30', page: 5 }, 'dz-aaaaaa': { catalog: 'dz-old' }, 'dz-bbbbbb': { catalog: 'dz-2026-10-17' } },
  };
  const merged = mergeManifest(previous, 'dz-2026-10-17', { type: 'wordpress-pages', photos: 1 }, [['dz-cccccc', { catalog: 'dz-2026-10-17', thumb: { width: 320, height: 240 }, image: 'https://example.com/a.jpg' }]]);
  assert.deepEqual(Object.keys(merged.items).sort(), ['dz-aaaaaa', 'dz-cccccc', 'scp-056']);
  assert.deepEqual(merged.catalogs['scp-2026-09-30'], { sha256: 'x' });
});

test("photos come from the catalog's photo host, or else the site host, or Shopify's image host for an export", async () => {
  const { photoHostFor } = await import('../scripts/props/demo.mjs');
  assert.equal(photoHostFor({ type: 'duda-gallery', siteUrl: 'https://www.vendor.example/', photoHost: 'irp.cdn-website.com' }), 'irp.cdn-website.com');
  assert.equal(photoHostFor({ type: 'wordpress-pages', siteUrl: 'https://vendor.example/props/' }), 'vendor.example');
  assert.equal(photoHostFor({ type: 'shopify-export', siteUrl: 'https://shop.example/products/' }), 'cdn.shopify.com');
});

test('npm run props:demo warns about missing website photos and about visible private notes', () => {
  const vendors = { vendors: [
    { name: 'Steel City Props', id: 'steel-city-props', catalogs: [{ id: 'scp-2026-09-30', type: 'pdf' }] },
    { name: 'Dezzign Central', id: 'dezzign-central', catalogs: [{ id: 'dz-2026-10-17', type: 'wordpress-pages' }] },
  ] };
  assert.deepEqual(demoWarnings({}, vendors, { catalogs: { 'dz-2026-10-17': { photos: 23 } } }), []);
  assert.match(demoWarnings({}, vendors, null).join('\n'), /No local photos for Dezzign Central.*--vendor dezzign-central/);
  assert.match(demoWarnings({ PROPS_SHOW_PRIVATE: '1' }, vendors, { catalogs: { 'dz-2026-10-17': {} } }).join('\n'), /private vendor notes are visible on the page\. Do not screenshare it\./);
});
