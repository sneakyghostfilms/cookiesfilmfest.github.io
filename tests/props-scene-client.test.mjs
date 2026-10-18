import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SCENE_TIMEOUT_MS, cardsForScene, cardsLoadForSubmit, checkSceneText, keepKnownKeys, periodNote, requestScene, trackCards } from '../src/scripts/props-scene.js';
import { parseDecades } from '../src/scripts/props-search.js';
import { GUARD_TIMEOUT_MS } from '../worker/src/budget.js';

const API = 'https://pgh-prop-search.example.workers.dev/';
const NOW = Date.UTC(2026, 9, 17, 16, 0, 0);
const SCENE = 'INT. OFFICE - DAY. Margaret answers the rotary phone.';

function fakeFetch(status, body, headers = {}) {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  };
  return { calls, send };
}

test('the client checks scene length before sending anything', () => {
  assert.match(checkSceneText('too short'), /at least 20/);
  assert.match(checkSceneText('x'.repeat(4001)), /at most 4,000/);
  assert.equal(checkSceneText(`   ${'x'.repeat(4000)}   `), null);
  assert.match(checkSceneText(SCENE, 'x'.repeat(41)), /40 characters/);
  assert.equal(checkSceneText(SCENE, ` ${'x'.repeat(40)} `), null);
});

test('the period is sent trimmed, and only when it is not blank', async () => {
  const answer = { ok: true, model: 'm', required: [], optional: [], ignoredSuggestions: 0 };
  for (const [period, expected] of [[' 1990s ', { text: SCENE, period: '1990s' }], ['   ', { text: SCENE }], [undefined, { text: SCENE }]]) {
    const { calls, send } = fakeFetch(200, answer);
    await requestScene(API, SCENE, { fetch: send, ...(period === undefined ? {} : { period }) });
    assert.deepEqual(JSON.parse(calls[0].init.body), expected, JSON.stringify(period));
  }
});

test('a period that names decades is disclosed as a filter on AI matching', () => {
  assert.equal(periodNote(' 1990s '), 'Items whose stated era is outside 1990s were left out of AI matching.');
  assert.equal(periodNote('late sixties'), 'Items whose stated era is outside late sixties were left out of AI matching.');
  assert.equal(periodNote('WWII'), null, 'a period without decades filters nothing');
  assert.equal(periodNote(''), null);
  assert.ok(parseDecades('late sixties').size > 0);
});

test('a successful answer posts the trimmed scene once and returns its props', async () => {
  const answer = { ok: true, model: 'm', required: [{ prop: 'phone', reason: 'r', keys: ['scp-056'] }], optional: [], ignoredSuggestions: 2 };
  const { calls, send } = fakeFetch(200, answer);
  const state = await requestScene(API, `  ${SCENE}  `, { fetch: send });
  assert.deepEqual(state, { kind: 'ok', model: 'm', required: answer.required, optional: [], ignored: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://pgh-prop-search.example.workers.dev/v1/scene');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: SCENE });
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
});

test('each Worker error becomes the matching page state, with no retry', async () => {
  const cases = [
    [429, { ok: false, error: 'rate_limited' }, {}, { kind: 'rate_limited' }],
    [503, { ok: false, error: 'ai_busy' }, {}, { kind: 'busy' }],
    [503, { ok: false, error: 'ai_not_configured' }, {}, { kind: 'unavailable' }],
    [503, { ok: false, error: 'ai_unavailable' }, {}, { kind: 'unavailable' }],
    [504, { ok: false, error: 'ai_timeout' }, {}, { kind: 'timeout' }],
    [413, { ok: false, error: 'text_too_long', message: 'Paste at most 4000 characters of the scene.' }, {}, { kind: 'invalid', message: 'Paste at most 4000 characters of the scene.' }],
    [400, { ok: false, error: 'period_invalid', message: 'Send the time period as text.' }, {}, { kind: 'invalid', message: 'Send the time period as text.' }],
    [400, { ok: false, error: 'period_too_long', message: 'Keep the time period to 40 characters.' }, {}, { kind: 'invalid', message: 'Keep the time period to 40 characters.' }],
    [502, { ok: false, error: 'ai_bad_output' }, {}, { kind: 'error' }],
    [502, { ok: false, error: 'ai_failed' }, {}, { kind: 'error' }],
    [500, 'not json', {}, { kind: 'error' }],
    [200, { ok: true, required: 'nope' }, {}, { kind: 'error' }],
  ];
  for (const [status, body, headers, expected] of cases) {
    const { calls, send } = fakeFetch(status, body, headers);
    assert.deepEqual(await requestScene(API, SCENE, { fetch: send }), expected, JSON.stringify(body));
    assert.equal(calls.length, 1);
  }
});

test('the quota state says when the budget resets, from Retry-After', async () => {
  const { send } = fakeFetch(503, { ok: false, error: 'quota_exhausted' }, { 'retry-after': '28800' });
  const state = await requestScene(API, SCENE, { fetch: send, now: () => NOW });
  assert.equal(state.kind, 'quota');
  assert.equal(state.resetsAt.toISOString(), '2026-10-18T00:00:00.000Z');
  const { send: noHeader } = fakeFetch(503, { ok: false, error: 'quota_exhausted' });
  assert.equal((await requestScene(API, SCENE, { fetch: noHeader })).resetsAt, null);
});

test('network failures and slow answers end in a state instead of hanging', async () => {
  let calls = 0;
  const offline = async () => { calls += 1; throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await requestScene(API, SCENE, { fetch: offline }), { kind: 'network' });
  const never = (url, init) => new Promise((_, reject) => {
    calls += 1;
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  assert.deepEqual(await requestScene(API, SCENE, { fetch: never, timeoutMs: 10 }), { kind: 'timeout' });
  assert.equal(calls, 2);
});

test('the page shows only items it knows, and counts the rest as ignored', () => {
  const state = { kind: 'ok', model: 'm', ignored: 1, required: [{ prop: 'phone', reason: 'r', keys: ['scp-056', 'scp-777'] }], optional: [{ prop: 'lamp', reason: 'r', keys: [] }] };
  const kept = keepKnownKeys(state, new Set(['scp-056']));
  assert.deepEqual(kept.required, [{ prop: 'phone', reason: 'r', keys: ['scp-056'] }]);
  assert.deepEqual(kept.optional, [{ prop: 'lamp', reason: 'r', keys: [] }]);
  assert.equal(kept.ignored, 2);
});

test('scene results wait for the card data: at once when it has loaded, with a waiting line while it loads, and a failure when it failed', async () => {
  const waits = [];
  const loaded = trackCards(Promise.resolve(['card']));
  await loaded.promise;
  assert.deepEqual(await cardsForScene(loaded, () => waits.push('loaded')), { ok: true, cards: ['card'] });
  let finish;
  const loading = trackCards(new Promise((resolve) => { finish = resolve; }));
  const pending = cardsForScene(loading, () => waits.push('loading'));
  finish(['late card']);
  assert.deepEqual(await pending, { ok: true, cards: ['late card'] });
  const failed = trackCards(Promise.reject(new Error('HTTP 404')));
  failed.promise.catch(() => {});
  assert.deepEqual(await cardsForScene(failed, () => waits.push('failed')), { ok: false });
  assert.deepEqual(waits, ['loading', 'failed'], 'the waiting line shows only while the data is not in yet');
});

test('a scene submit loads the item list again after a failed load, and keeps one that loaded or is still loading', async () => {
  const loads = [];
  const load = (outcome) => () => {
    loads.push(outcome);
    if (outcome === 'fails') return Promise.reject(new Error('HTTP 404'));
    return outcome === 'loads' ? Promise.resolve(['card']) : new Promise(() => {});
  };
  const failed = cardsLoadForSubmit(undefined, load('fails'));
  assert.deepEqual(await cardsForScene(failed, () => {}), { ok: false });
  assert.deepEqual([failed.settled, failed.failed], [true, true]);
  const retried = cardsLoadForSubmit(failed, load('loads'));
  assert.notEqual(retried, failed);
  assert.deepEqual(await cardsForScene(retried, () => {}), { ok: true, cards: ['card'] });
  assert.equal(retried.failed, false);
  assert.equal(cardsLoadForSubmit(retried, load('loads')), retried, 'a loaded list is kept');
  const pending = cardsLoadForSubmit(undefined, load('hangs'));
  assert.equal(cardsLoadForSubmit(pending, load('loads')), pending, 'a list still loading is kept');
  assert.deepEqual(loads, ['fails', 'loads', 'hangs']);
});

test('an item list that fails while nothing awaits it yet is not reported as an unhandled rejection', async () => {
  const unhandled = [];
  const record = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', record);
  try {
    const failed = trackCards(Promise.reject(new Error('HTTP 404')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(unhandled, []);
    assert.deepEqual(await cardsForScene(failed, () => {}), { ok: false }, 'the scene still learns of the failure');
  } finally {
    process.off('unhandledRejection', record);
  }
});

test('the page waits longer than the Worker can take to answer', async () => {
  const { vars } = JSON.parse(await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8'));
  const workerAnswersWithin = Number(vars.AI_TIMEOUT_MS) + 2 * GUARD_TIMEOUT_MS;
  assert.ok(SCENE_TIMEOUT_MS > workerAnswersWithin, `client ${SCENE_TIMEOUT_MS} ms vs Worker ${workerAnswersWithin} ms`);
});
