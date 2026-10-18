import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { formatScan, scanBody, scanVendor } from '../scripts/props/cache-scan.mjs';

// Built at run time: the six characters of a JSON escape (a backslash, then u0026), not the ampersand.
const BACKSLASH = String.fromCharCode(92);
const JSON_AMPERSAND = `${BACKSLASH}u0026`;
const PAGE = [
  '<a href="/shop/?id=7&amp;page=2">more</a>',
  "<img src='https://cdn.example/a.jpg?w=320&#038;h=240' srcset=\"/b.jpg?w=640 2x, /c.jpg?dpr=3 3x\">",
  '<form action="/search/?sort=asc"></form><meta property="og:url" content="https://shop.example/?srsltid=REDACTED">',
  '<a href="https://share.example/?u=https%3A%2F%2Fshop.example%2F%3Fmibextid%3Dmade-up%26lang%3Den">share</a>',
  `<script>window.data={"link":"https:${BACKSLASH}/${BACKSLASH}/shop.example${BACKSLASH}/?cat=lamps${JSON_AMPERSAND}gclid=REDACTED"};`,
  'n.src=t.img+"?w="+r+"&h="+o;if(a.img&&e)q("?zoom=1")</script>',
  '<p>Our "best" pick?</p>',
].join('\n');

test('the scan lists the query-parameter names of URLs in attributes and JSON strings, with counts, and no value', () => {
  const { counts, holding } = scanBody(PAGE);
  assert.deepEqual(Object.fromEntries([...counts].sort()), { cat: 1, dpr: 1, gclid: 1, h: 1, id: 1, lang: 1, mibextid: 1, page: 1, sort: 1, srsltid: 1, u: 1, w: 2 });
  assert.deepEqual([...holding], ['mibextid'], 'a tracking name still holding a value other than REDACTED');
});

test('names in script code, quoted prose and query fragments that are not URLs stay out', () => {
  const { counts } = scanBody('<script>n.src=t.img+"?w="+r;var a={img:"x?y=1"};</script><p>"why?" she asked</p>');
  assert.deepEqual([...counts], []);
});

test('a vendor scan reads every cached text body, skips binary ones, and prints names and counts only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cache-scan-'));
  try {
    const catalog = path.join(root, 'some-vendor', 'sv-2026-10-18');
    await mkdir(catalog, { recursive: true });
    await writeFile(path.join(catalog, 'a.body'), PAGE);
    await writeFile(path.join(catalog, 'a.meta.json'), JSON.stringify({ url: 'https://shop.example/', status: 200, contentType: 'text/html' }));
    await writeFile(path.join(catalog, 'b.body'), '{"next":"/api/?page=3&_kx=made-up"}');
    await writeFile(path.join(catalog, 'b.meta.json'), JSON.stringify({ url: 'https://shop.example/api/', status: 200, contentType: 'application/json' }));
    await writeFile(path.join(catalog, 'c.body'), 'href="/x?made-up-binary=1"');
    await writeFile(path.join(catalog, 'c.meta.json'), JSON.stringify({ url: 'https://shop.example/c.jpg', status: 200, contentType: 'image/jpeg' }));
    const result = await scanVendor(path.join(root, 'some-vendor'));
    assert.deepEqual([result.bodies, result.skipped, result.counts.get('page'), [...result.holding].sort()], [2, 1, 2, ['_kx', 'mibextid']]);
    const printed = formatScan('some-vendor', result);
    assert.equal(printed, [
      'some-vendor: 2 cached text bodies scanned, 1 binary skipped',
      '  query-parameter names: _kx 1, cat 1, dpr 1, gclid 1, h 1, id 1, lang 1, mibextid 1, page 2, sort 1, srsltid 1, u 1, w 2',
      '  tracking names still holding a value: _kx, mibextid',
    ].join('\n'));
    assert.doesNotMatch(printed, /made-up|REDACTED|shop\.example/, 'no value and no URL is printed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
