import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FetchStopped, JITTER_MS, MIN_GAP_MS, TIMEOUT_MS, USER_AGENT, cacheName, createSiteFetcher, hostProblem } from '../scripts/props/site-fetch.mjs';
import { robotsAllow, robotsRules, robotsStopReason } from '../scripts/props/robots.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const HOST = 'vendor.example.com';
const url = (page) => `https://${HOST}/${page}`;

function harness(responses, options = {}) {
  const calls = [];
  const waits = [];
  let clock = 1_000_000;
  const fetcher = createSiteFetcher({
    allowHosts: [HOST],
    fetch: async (requested, init) => {
      calls.push({ url: requested, init });
      const respond = responses[requested];
      if (!respond) throw new Error(`unexpected request for ${requested}`);
      return respond({ advance: (ms) => { clock += ms; } });
    },
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    now: () => clock,
    guard: () => null,
    ...options,
  });
  return { calls, waits, fetcher };
}

const ok = (body) => () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
const status = (code, headers = {}) => () => new Response(null, { status: code, headers });
const freshDirectory = () => mkdtemp(path.join(tmpdir(), 'props-cache-'));

test('requests carry the honest User-Agent, never follow redirects, and are fetched once', async () => {
  const directory = await freshDirectory();
  const { calls, fetcher } = harness({ [url('a')]: ok('{"a":1}') });
  const first = await fetcher.get(url('a'), directory);
  assert.equal(first.body.toString(), '{"a":1}');
  assert.equal(first.cached, false);
  assert.equal(calls[0].init.headers['user-agent'], USER_AGENT);
  assert.match(USER_AGENT, /^PittsburghPropSearch\/\S+ \(.*\+https:\/\/cookiesfilmfest\.com\/#contact\)$/);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'every request has a timeout');
  assert.ok(TIMEOUT_MS <= 60_000);
  assert.deepEqual((await readdir(directory)).sort(), [`${cacheName(url('a'))}.body`, `${cacheName(url('a'))}.meta.json`]);
  const again = await fetcher.get(url('a'), directory);
  assert.equal(again.cached, true);
  assert.equal(again.body.toString(), '{"a":1}');
  assert.equal(again.meta.url, url('a'));
  assert.equal(calls.length, 1);
  assert.deepEqual(fetcher.stats(), { requests: 1, cacheHits: 1 });
});

test('requests are at least two seconds apart, plus jitter', async () => {
  const directory = await freshDirectory();
  const { waits, fetcher } = harness({ [url('a')]: ok('a'), [url('b')]: ok('b'), [url('c')]: ok('c') });
  for (const page of ['a', 'b', 'c']) await fetcher.get(url(page), directory);
  assert.ok(MIN_GAP_MS >= 2000);
  assert.deepEqual(waits, [MIN_GAP_MS + JITTER_MS / 2, MIN_GAP_MS + JITTER_MS / 2]);
});

test('the gap is measured from the end of the previous response, however slow it was', async () => {
  const directory = await freshDirectory();
  const slow = (body) => ({ advance }) => {
    advance(5000);
    return new Response(body, { status: 200 });
  };
  const { waits, fetcher } = harness({ [url('a')]: slow('a'), [url('b')]: slow('b') });
  await fetcher.get(url('a'), directory);
  await fetcher.get(url('b'), directory);
  assert.deepEqual(waits, [MIN_GAP_MS + JITTER_MS / 2]);
});

test('a 429 or 403 stops the run at once, with no retry and nothing cached', async () => {
  for (const code of [429, 403]) {
    const directory = await freshDirectory();
    const { calls, fetcher } = harness({ [url('a')]: status(code, { 'retry-after': '60' }), [url('b')]: ok('b') });
    await assert.rejects(fetcher.get(url('a'), directory), (error) => error instanceof FetchStopped && error.status === code && error.retryAfter === '60');
    await assert.rejects(fetcher.get(url('b'), directory), FetchStopped);
    assert.equal(calls.length, 1, String(code));
    assert.deepEqual(await readdir(directory), []);
  }
});

test('a redirect stops the run after one request and is never followed', async () => {
  const directory = await freshDirectory();
  const elsewhere = 'https://retroon8th.com/products/anything';
  const { calls, fetcher } = harness({ [url('a')]: status(302, { location: elsewhere }) });
  await assert.rejects(fetcher.get(url('a'), directory), (error) => error instanceof FetchStopped && error.status === 302 && error.location === elsewhere);
  assert.deepEqual(calls.map((call) => call.url), [url('a')]);
  assert.deepEqual(await readdir(directory), []);
});

test('other HTTP errors and network failures stop the run', async () => {
  const directory = await freshDirectory();
  const { fetcher } = harness({ [url('a')]: status(500) });
  await assert.rejects(fetcher.get(url('a'), directory), (error) => error instanceof FetchStopped && error.status === 500);
  const broken = harness({ [url('a')]: () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(broken.fetcher.get(url('a'), directory), (error) => error instanceof FetchStopped && error.reason === 'network');
});

test('Retro on 8th and Shopify store hosts are refused before any request, whatever the allowlist says', async () => {
  for (const host of ['retroon8th.com', 'www.retroon8th.com', 'retroon8th.com.', 'RetroOn8th.com', 'retro-on-8th.myshopify.com', 'another-store.myshopify.com']) {
    assert.match(hostProblem(`https://${host}/products.json`, [host]), /never contacted/, host);
    const { calls, fetcher } = harness({}, { allowHosts: [host] });
    await assert.rejects(fetcher.get(`https://${host}/products.json`, await freshDirectory()), (error) => error.reason === 'refused');
    assert.equal(calls.length, 0, host);
  }
  assert.match(hostProblem('https://cdn.shopify.com/s/files/1/x.jpg', [HOST]), /not an allowed host/);
  assert.equal(hostProblem('https://cdn.shopify.com/s/files/1/x.jpg', ['cdn.shopify.com']), null);
  assert.match(hostProblem(`http://${HOST}/a`, [HOST]), /only https/);
  assert.match(hostProblem('not a url', [HOST]), /not a URL/);
});

test('vendor content is cached only where git ignores it', async () => {
  const { calls, fetcher } = harness({ [url('a')]: ok('a') }, { guard: undefined });
  await assert.rejects(fetcher.get(url('a'), path.join(root, 'scripts/props/not-ignored')), (error) => error.reason === 'guard');
  assert.equal(calls.length, 0);
  assert.ok(!existsSync(path.join(root, 'scripts/props/not-ignored')));
  const strict = createSiteFetcher({ allowHosts: [HOST], fetch: async () => { throw new Error('no network in tests'); } });
  await assert.rejects(strict.get(url('a'), path.join(root, 'src/data/props/cache')), (error) => error.reason === 'guard');
});

test('a cache entry must belong to the URL asked for', async () => {
  const directory = await freshDirectory();
  const name = cacheName(url('a'));
  await writeFile(path.join(directory, `${name}.body`), 'other');
  await writeFile(path.join(directory, `${name}.meta.json`), JSON.stringify({ url: url('b') }));
  const { calls, fetcher } = harness({});
  await assert.rejects(fetcher.get(url('a'), directory), (error) => error.reason === 'cache');
  assert.equal(calls.length, 0);
});

test('a run can slow down to a declared delay, but never below the minimum gap', async () => {
  const directory = await freshDirectory();
  const { waits, fetcher } = harness({ [url('a')]: ok('a'), [url('b')]: ok('b'), [url('c')]: ok('c') });
  await fetcher.get(url('a'), directory);
  fetcher.raiseGap(500);
  await fetcher.get(url('b'), directory);
  fetcher.raiseGap(10_000);
  await fetcher.get(url('c'), directory);
  assert.deepEqual(waits, [MIN_GAP_MS + JITTER_MS / 2, 10_000 + JITTER_MS / 2]);
});

test('missingOk reads a 404 or 410 as missing and caches it; other errors, and the same URL without missingOk, still stop', async () => {
  const directory = await freshDirectory();
  const { calls, fetcher } = harness({ [url('robots.txt')]: status(404), [url('gone.txt')]: status(410), [url('busy.txt')]: status(503) });
  const first = await fetcher.get(url('robots.txt'), directory, { missingOk: true });
  assert.equal(first.missing, true);
  const again = await fetcher.get(url('robots.txt'), directory, { missingOk: true });
  assert.deepEqual([again.cached, again.missing, calls.length], [true, true, 1]);
  assert.equal((await fetcher.get(url('gone.txt'), directory, { missingOk: true })).missing, true);
  await assert.rejects(fetcher.get(url('robots.txt'), directory), FetchStopped);
  const fresh = harness({ [url('busy.txt')]: status(503) }).fetcher;
  await assert.rejects(fresh.get(url('busy.txt'), await freshDirectory(), { missingOk: true }), (error) => error instanceof FetchStopped && error.status === 503);
});

test('robots rules: our named group beats *, plain prefixes only, anything else is reported instead of guessed', () => {
  assert.deepEqual(robotsRules(''), { group: null, disallow: [], crawlDelaySeconds: null, unsupported: [] });
  const star = robotsRules('User-agent: *\nDisallow: /private/\nCrawl-delay: 5\nAllow: /private/ok\n');
  assert.deepEqual(star, { group: '*', disallow: ['/private/'], crawlDelaySeconds: 5, unsupported: [] });
  assert.equal(robotsAllow(star, '/private/a.jpg'), false);
  assert.equal(robotsAllow(star, '/public/a.jpg'), true);
  const named = robotsRules('User-agent: *\nDisallow: /\n\nUser-agent: PittsburghPropSearch\nDisallow: /tmp/ # ours\n');
  assert.deepEqual([named.group, named.disallow], ['PittsburghPropSearch', ['/tmp/']]);
  assert.deepEqual(robotsRules('User-agent: other\nUser-agent: *\nDisallow: /x\n').disallow, ['/x'], 'a group can name several agents');
  assert.deepEqual(robotsRules('User-agent: *\nDisallow:\n').disallow, [], 'an empty Disallow allows everything');
  assert.deepEqual(robotsRules('User-agent: *\nDisallow: /*.jpg$\n').unsupported, ['Disallow: /*.jpg$']);
  assert.deepEqual(robotsRules('User-agent: *\nDisallow: images\n').unsupported, ['Disallow: images']);
  assert.deepEqual(robotsRules('User-agent: *\nCrawl-delay: soon\n').unsupported, ['Crawl-delay: soon']);
  assert.deepEqual(robotsRules('User-agent: other\nDisallow: /*\n').unsupported, [], "another agent's rules don't apply to us");
});

test('photo downloads stop before any request when robots.txt disallows a photo path or has a rule we cannot apply', () => {
  const photos = ['https://cdn.example/a/opt/one-640w.jpg', 'https://cdn.example/b/two-640w.jpg'];
  assert.equal(robotsStopReason(robotsRules(''), photos, 'cdn.example'), null);
  assert.equal(robotsStopReason(robotsRules('User-agent: *\nDisallow: /private/\n'), photos, 'cdn.example'), null);
  assert.match(robotsStopReason(robotsRules('User-agent: *\nDisallow: /a/\n'), photos, 'cdn.example'), /disallows 1 of the 2 photo paths, for example \/a\/opt\/one-640w\.jpg/);
  assert.match(robotsStopReason(robotsRules('User-agent: *\nDisallow: /*.jpg$\n'), photos, 'cdn.example'), /can't apply with certainty \(Disallow: \/\*\.jpg\$\)/);
});
