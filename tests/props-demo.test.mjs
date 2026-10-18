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
import { demoAssetHandler, propsDemo } from '../scripts/props/demo-server.mjs';
import { privateOutputProblem } from '../scripts/props/demo.mjs';

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

test('raw vendor responses stay in the ignored cache, and only known CSV files are tracked', () => {
  assert.equal(git('ls-files', '.props-cache').stdout, '');
  assert.equal(git('ls-files', '.props-private').stdout, '');
  assert.equal(git('check-ignore', '-q', '.props-private/vendors.json').status, 0, '.props-private/vendors.json');
  for (const file of ['.props-cache/dezzign-central/dz-2026-10-17/0123456789abcdef.body', '.props-demo/originals/dezzign-central/0123456789abcdef.body']) {
    assert.equal(git('check-ignore', '-q', file).status, 0, file);
  }
  const tracked = git('ls-files').stdout.split('\n');
  assert.deepEqual(tracked.filter((file) => /\.csv$/i.test(file) && !TRACKED_CSV.includes(file)), [], 'a vendor export or other CSV is tracked');
  assert.deepEqual(tracked.filter((file) => /\.html?$/i.test(file)), [], 'an HTML page is tracked');
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
  const demo = await readFile(path.join(root, 'scripts/props/demo.mjs'), 'utf8');
  assert.doesNotMatch(demo, /PROPS_SHOW_PRIVATE/, 'npm run props:demo never sets the flag');
});
