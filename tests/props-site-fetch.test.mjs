import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FetchStopped, JITTER_MS, MIN_GAP_MS, TIMEOUT_MS, USER_AGENT, cacheName, createSiteFetcher, hostProblem } from '../scripts/props/site-fetch.mjs';
import { robotsCheckedFetcher } from '../scripts/props/import-site.mjs';
import { robotsAllow, robotsRules, robotsStopReason, robotsTarget } from '../scripts/props/robots.mjs';

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

test('tracking values are replaced before a page is cached, the meta file names only the parameters, and photos are stored as fetched', async () => {
  const directory = await freshDirectory();
  const page = '<a href="/list/?page=2&amp;_kx=made-up-token">next</a><input type="hidden" name="gclid" value="made-up">';
  const typed = (type) => () => new Response(page, { status: 200, headers: { 'content-type': type } });
  const { calls, fetcher } = harness({ [url('list')]: typed('text/html; charset=UTF-8'), [url('photo.jpg')]: typed('image/jpeg') });
  const expected = '<a href="/list/?page=2&amp;_kx=REDACTED">next</a><input type="hidden" name="gclid" value="REDACTED">';
  const fresh = await fetcher.get(url('list'), directory);
  assert.equal(fresh.body.toString(), expected);
  assert.deepEqual(fresh.meta.redacted, ['_kx', 'gclid']);
  const stored = path.join(directory, cacheName(url('list')));
  assert.equal(await readFile(`${stored}.body`, 'utf8'), expected);
  const metaText = await readFile(`${stored}.meta.json`, 'utf8');
  assert.deepEqual(JSON.parse(metaText).redacted, ['_kx', 'gclid']);
  assert.ok(!metaText.includes('made-up'), 'the meta file holds no value');
  const again = await fetcher.get(url('list'), directory);
  assert.deepEqual([again.cached, again.body.toString()], [true, expected]);
  const photo = await fetcher.get(url('photo.jpg'), directory);
  assert.equal(photo.body.toString(), page, 'a photo is stored as fetched');
  assert.ok(!('redacted' in photo.meta));
  const clean = harness({ [url('plain')]: () => new Response('<a href="/?page=2">', { status: 200, headers: { 'content-type': 'text/html' } }) });
  assert.ok(!('redacted' in (await clean.fetcher.get(url('plain'), directory)).meta), 'a clean page gets no note');
  assert.equal(calls.length, 2);
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
  const broken = harness({ [url('a')]: () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }); } });
  await assert.rejects(broken.fetcher.get(url('a'), directory), (error) => error instanceof FetchStopped && error.reason === 'network' && error.message.endsWith('fetch failed (ECONNRESET)'));
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

test('missingOk reads 401, 403, 404 or 410 as missing (RFC 9309: robots.txt unavailable) and caches it; 429, 5xx and the same URL without missingOk still stop', async () => {
  const directory = await freshDirectory();
  const { calls, fetcher } = harness({ [url('robots.txt')]: status(404), [url('gone.txt')]: status(410), [url('denied.txt')]: status(403), [url('auth.txt')]: status(401) });
  const first = await fetcher.get(url('robots.txt'), directory, { missingOk: true });
  assert.equal(first.missing, true);
  const again = await fetcher.get(url('robots.txt'), directory, { missingOk: true });
  assert.deepEqual([again.cached, again.missing, calls.length], [true, true, 1]);
  for (const page of ['gone.txt', 'denied.txt', 'auth.txt']) assert.equal((await fetcher.get(url(page), directory, { missingOk: true })).missing, true, page);
  await assert.rejects(fetcher.get(url('robots.txt'), directory), FetchStopped);
  for (const code of [429, 500, 503]) {
    const fresh = harness({ [url('busy.txt')]: status(code) }).fetcher;
    await assert.rejects(fresh.get(url('busy.txt'), await freshDirectory(), { missingOk: true }), (error) => error instanceof FetchStopped && error.status === code, String(code));
  }
});

test('robots rules: our named group beats *, groups for the same agent merge, and a rule we cannot apply is reported instead of guessed', () => {
  assert.deepEqual(robotsRules(''), { group: null, disallow: [], crawlDelaySeconds: null, unsupported: [] });
  const star = robotsRules('User-agent: *\nDisallow: /private/\nCrawl-delay: 5\nAllow: /private/ok\n');
  assert.deepEqual(star, { group: '*', disallow: ['/private/'], crawlDelaySeconds: 5, unsupported: [] });
  assert.equal(robotsAllow(star, '/private/a.jpg'), false);
  assert.equal(robotsAllow(star, '/public/a.jpg'), true);
  const named = robotsRules('User-agent: *\nDisallow: /\n\nUser-agent: PittsburghPropSearch\nDisallow: /tmp/ # ours\n');
  assert.deepEqual([named.group, named.disallow], ['PittsburghPropSearch', ['/tmp/']]);
  assert.deepEqual(robotsRules('User-agent: other\nUser-agent: *\nDisallow: /x\n').disallow, ['/x'], 'a group can name several agents');
  assert.deepEqual(robotsRules('User-agent: *\nDisallow:\n').disallow, [], 'an empty Disallow allows everything');
  for (const eol of ['\n', '\r\n', '\r']) assert.deepEqual(robotsRules(`User-agent: *${eol}Disallow: /private/${eol}`).disallow, ['/private/'], JSON.stringify(eol));
  assert.deepEqual(robotsRules('User-agent: *\nDisallow: /*.jpg$\n').disallow, ['/*.jpg$'], 'wildcards and a final $ are applied');
  assert.deepEqual(robotsRules('User-agent: *\nDisallow: /a$b\n').unsupported, ['Disallow: /a$b'], 'a $ before the end is not');
  assert.deepEqual(robotsRules('User-agent: *\nDisallow: images\n').unsupported, ['Disallow: images']);
  assert.deepEqual(robotsRules('User-agent: *\nDisallow: /a/\n\nUser-agent: *\nDisallow: /b/\n').disallow, ['/a/', '/b/'], 'two * groups merge');
  assert.deepEqual(robotsRules('User-agent: *\nCrawl-delay: soon\n').unsupported, ['Crawl-delay: soon']);
  assert.deepEqual(robotsRules('User-agent: other\nDisallow: /*\n').unsupported, [], "another agent's rules don't apply to us");
  for (const name of ['search', 'Pittsburgh', 'p', 'PittsburghPropSearchBot']) {
    const rules = robotsRules(`User-agent: *\nDisallow: /\n\nUser-agent: ${name}\nDisallow:\n`);
    assert.deepEqual([rules.group, rules.disallow], ['*', ['/']], `"${name}" is not our product token`);
  }
  const barred = (group) => robotsRules(`User-agent: *\nDisallow: /\n\n${group}`);
  assert.deepEqual(barred('User-agent: search\nDisallow:').disallow, ['/'], 'reproduction 1');
  assert.deepEqual(barred('User-agent: Pittsburgh\nDisallow:').disallow, ['/'], 'reproduction 2');
  assert.deepEqual(barred('User-agent: p\nAllow: /').disallow, ['/'], 'reproduction 3');
  assert.deepEqual(robotsRules('User-agent: PittsburghPropSearch/0.1\nDisallow: /x/').disallow, ['/x/'], 'a versioned token names us');
  for (const name of ['PittsburghPropSearch/0.1', 'pittsburghpropsearch']) {
    assert.deepEqual(robotsRules(`User-agent: *\nDisallow: /\n\nUser-agent: ${name}\nDisallow: /x/\n`).disallow, ['/x/'], `"${name}" names us`);
  }
});

test('photo downloads stop before any request when robots.txt disallows a photo path or has a rule we cannot apply', () => {
  const photos = ['https://cdn.example/a/opt/one-640w.jpg', 'https://cdn.example/b/two-640w.jpg'];
  assert.equal(robotsStopReason(robotsRules(''), photos, 'cdn.example'), null);
  assert.equal(robotsStopReason(robotsRules('User-agent: *\nDisallow: /private/\n'), photos, 'cdn.example'), null);
  assert.match(robotsStopReason(robotsRules('User-agent: *\nDisallow: /a/\n'), photos, 'cdn.example'), /disallows 1 of the 2 photo paths, for example \/a\/opt\/one-640w\.jpg/);
  assert.match(robotsStopReason(robotsRules('User-agent: *\nDisallow: /*.jpg$\n'), photos, 'cdn.example'), /disallows 2 of the 2 photo paths/);
  assert.match(robotsStopReason(robotsRules('User-agent: *\nDisallow: /a$b\n'), photos, 'cdn.example'), /can't apply with certainty \(Disallow: \/a\$b\)/);
  const sized = ['https://cdn.example/u/one.jpeg?width=640'];
  assert.match(robotsStopReason(robotsRules('User-agent: *\nDisallow: /*?width=\n'), sized, 'cdn.example'), /disallows 1 of the 1 photo paths, for example \/u\/one\.jpeg\?width=640/, 'the query is part of what a rule matches');
  assert.equal(robotsStopReason(robotsRules('User-agent: *\nDisallow: /*.jpeg$\n'), sized, 'cdn.example'), null, 'a final $ ends at the path and query');
});

test("robots rules match the path and query as RFC 9309's examples do, with regex characters taken literally", () => {
  const vectors = [
    ['/fish', '/fish', true], ['/fish', '/fish.html', true], ['/fish', '/fish/salmon.html', true], ['/fish', '/fishheads', true],
    ['/fish', '/fish.php?id=anything', true], ['/fish', '/Fish.asp', false], ['/fish', '/catfish', false], ['/fish', '/?id=fish', false], ['/fish', '/desert/fish', false],
    ['/fish*', '/fishheads/yummy.html', true], ['/fish*', '/catfish', false],
    ['/fish/', '/fish/?id=anything', true], ['/fish/', '/fish', false],
    ['/*.php', '/index.php', true], ['/*.php', '/folder/filename.php?parameters', true], ['/*.php', '/windows.PHP', false],
    ['/*.php$', '/folder/filename.php', true], ['/*.php$', '/filename.php?parameters', false], ['/*.php$', '/filename.php5', false],
    ['/fish*.php', '/fishheads/catfish.php?parameters', true], ['/fish*.php', '/Fish.PHP', false],
    ['/', '/anything?x=1', true], ['/$', '/', true], ['/$', '/a', false],
    ['/*?add-to-basket=', '/shop/', false], ['/*?add-to-basket=', '/shop/?add-to-basket=5', true],
    ['/*?*add-to-basket=', '/shop/?a=1&add-to-basket=5', true], ['/*?*add-to-basket=', '/shop/?view=list', false],
    ['/item/*/*/review', '/item/lamp/42/review', true], ['/item/*/*/review', '/item/lamp/42', false],
    ['/?q=', '/?q=lamp', true], ['/?q=', '/', false], ['/page/*/?q=', '/shop/page/2/', false],
    ['/a.b', '/axb', false], ['/a.b', '/a.b', true], ['/a+b', '/a+b', true], ['/a+b', '/aab', false], ['/a(b)', '/a(b)/c', true], ['/a**b', '/a-x-b', true],
  ];
  for (const [rule, target, disallowed] of vectors) {
    assert.equal(!robotsAllow(robotsRules(`User-agent: *\nDisallow: ${rule}\n`), target), disallowed, `${rule} on ${target}`);
  }
  assert.equal(robotsTarget('https://cdn.example/a/b.jpeg?width=640'), '/a/b.jpeg?width=640');
});

test("a store host's robots.txt is read first: a Crawl-delay slows the run, a disallowed page is refused before any request, and a rule we can't apply stops it", async () => {
  const robotsFile = 'User-agent: *\nDisallow: /private/\nDisallow: /*?basket=\nCrawl-delay: 5\n';
  const directory = await freshDirectory();
  const { calls, waits, fetcher } = harness({ [url('robots.txt')]: () => new Response(robotsFile, { status: 200 }), [url('shop/1')]: ok('[]'), [url('shop/2')]: ok('[]') });
  const site = await robotsCheckedFetcher(fetcher, url('shop/'), directory);
  assert.equal(site.rules.crawlDelaySeconds, 5);
  await site.get(url('shop/1'), directory);
  await site.get(url('shop/2'), directory);
  assert.deepEqual(calls.map((call) => call.url), [url('robots.txt'), url('shop/1'), url('shop/2')]);
  assert.ok(waits.every((ms) => ms >= 5000) && waits.length === 2, `gaps ${waits.join(', ')}`);
  for (const refused of [url('private/a'), url('shop/?basket=1')]) {
    await assert.rejects(site.get(refused, directory), (error) => error instanceof FetchStopped && /disallows/.test(error.message), refused);
  }
  assert.equal(calls.length, 3, 'nothing disallowed was requested');
  const unsure = harness({ [url('robots.txt')]: () => new Response('User-agent: *\nDisallow: /a$b\n', { status: 200 }) });
  await assert.rejects(robotsCheckedFetcher(unsure.fetcher, url('shop/'), await freshDirectory()), /can't apply with certainty/);
  const none = harness({ [url('robots.txt')]: status(404), [url('shop/1')]: ok('[]') });
  const open = await robotsCheckedFetcher(none.fetcher, url('shop/'), await freshDirectory());
  assert.deepEqual([open.rules.disallow, open.rules.crawlDelaySeconds], [[], null], 'a missing robots.txt means no rules');
});
