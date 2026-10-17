import assert from 'node:assert/strict';
import test from 'node:test';
import { reserve } from '../src/budget.js';
import { handleRequest } from '../src/index.js';
import { inventoryText } from '../src/inventory.js';
import { LIMITS, MODELS, buildRequest, estimateNeurons } from '../src/scene.js';
import { MODEL, NOW, budgetNamespace, fakeAI, fixedClock, makeEnv, memoryStorage, sceneRequest } from './helpers.mjs';

const SHORT = 'x'.repeat(30);
const SHORT_COST = estimateNeurons(MODEL, buildRequest(inventoryText, SHORT));

async function send(env, { ip, now = NOW, text } = {}) {
  const response = await handleRequest(sceneRequest(text, { ip }), env, fixedClock(now));
  return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
}

test('missing or malformed guard settings fail closed before the budget or the AI is touched', async () => {
  const broken = [
    { DAILY_NEURON_BUDGET: undefined }, { DAILY_NEURON_BUDGET: '' }, { DAILY_NEURON_BUDGET: 'lots' }, { DAILY_NEURON_BUDGET: '0' },
    { DAILY_NEURON_BUDGET: '-5' }, { AI_PER_MINUTE_LIMIT: 'NaN' }, { AI_PER_CLIENT_PER_MINUTE: '' }, { AI_TIMEOUT_MS: '0' },
    { AI_MODEL: '@cf/meta/llama-3.1-8b-instruct' }, { AI_MODEL: 'toString' }, { AI: undefined }, { AI_BUDGET: undefined },
  ];
  for (const change of broken) {
    const env = makeEnv(change);
    const { status, body } = await send(env);
    assert.equal(status, 503, JSON.stringify(change));
    assert.equal(body.error, 'ai_not_configured');
    assert.equal(env.AI?.calls.length ?? 0, 0);
    assert.equal(env.AI_BUDGET?.storage.writes.length ?? 0, 0);
  }
});

test('a guard that throws, hangs or answers nonsense stops the AI call', async () => {
  const stubs = [
    { fetch: async () => { throw new Error('object reset'); } },
    { fetch: () => new Promise(() => {}) },
    { fetch: async () => Response.json({}) },
    { fetch: async () => Response.json('ok') },
    { fetch: async () => Response.json({ ok: 'yes' }) },
    { fetch: async () => new Response('not json') },
  ];
  for (const stub of stubs) {
    const env = makeEnv({ AI_BUDGET: { idFromName: () => 'global', get: () => stub } });
    const { status, body } = await send(env);
    assert.equal(status, 503);
    assert.equal(body.error, 'ai_unavailable');
    assert.equal(env.AI.calls.length, 0);
  }
});

test('the daily budget refuses requests that would pass it and resets at midnight UTC', async () => {
  const budget = Math.ceil(SHORT_COST * 3.5);
  const env = makeEnv({ DAILY_NEURON_BUDGET: String(budget) });
  const fits = Math.floor(budget / SHORT_COST);
  assert.equal(fits, 3);
  for (let index = 0; index < fits; index += 1) {
    assert.equal((await send(env, { ip: `198.51.100.${index}`, now: NOW + index * 61_000, text: SHORT })).status, 200);
  }
  const refused = await send(env, { ip: '198.51.100.250', now: NOW + fits * 61_000, text: SHORT });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error, 'quota_exhausted');
  const midnight = Date.UTC(2026, 9, 18);
  assert.equal(Number(refused.retryAfter), Math.ceil((midnight - (NOW + fits * 61_000)) / 1000));
  assert.equal(env.AI.calls.length, fits);
  assert.equal((await send(env, { now: midnight + 1000, text: SHORT })).status, 200);
});

test('one client gets 3 requests a minute while others still get through', async () => {
  const env = makeEnv();
  for (let index = 0; index < 3; index += 1) assert.equal((await send(env, { ip: '203.0.113.7' })).status, 200);
  const limited = await send(env, { ip: '203.0.113.7' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal(limited.retryAfter, '60');
  assert.equal(env.AI.calls.length, 3);
  assert.equal((await send(env, { ip: '203.0.113.8' })).status, 200);
  assert.equal((await send(env, { ip: '203.0.113.7', now: NOW + 60_000 })).status, 200);
});

test('the global cap stops the 21st request in a minute', async () => {
  const env = makeEnv({ AI_PER_CLIENT_PER_MINUTE: '100' });
  for (let index = 0; index < 20; index += 1) assert.equal((await send(env, { ip: `192.0.2.${index}` })).status, 200);
  const capped = await send(env, { ip: '192.0.2.200' });
  assert.equal(capped.status, 429);
  assert.equal(env.AI.calls.length, 20);
});

test('concurrent requests cannot overspend the daily budget', async () => {
  const budget = Math.ceil(SHORT_COST * 3.5);
  const env = makeEnv({ DAILY_NEURON_BUDGET: String(budget), AI_PER_CLIENT_PER_MINUTE: '100', AI_PER_MINUTE_LIMIT: '100' });
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => send(env, { ip: `192.0.2.${index}`, text: SHORT })));
  assert.equal(results.filter((result) => result.status === 200).length, 3);
  assert.ok(env.AI_BUDGET.storage.values.get('spend').spent <= budget);
});

test('the guard stores only the day and the amount spent, never the client address', async () => {
  const storage = memoryStorage();
  const env = makeEnv({ AI_BUDGET: budgetNamespace(storage) });
  await send(env, { ip: '203.0.113.99' });
  await send(env, { ip: '203.0.113.99' });
  assert.ok(storage.writes.length > 0);
  for (const [key, value] of storage.writes) {
    assert.equal(key, 'spend');
    assert.deepEqual(Object.keys(value).sort(), ['day', 'spent']);
    assert.ok(!JSON.stringify(value).includes('203.0.113.99'));
  }
});

test('the pre-charge bounds input tokens by UTF-8 bytes, so non-Latin scenes cost more', () => {
  const ascii = buildRequest(inventoryText, 'x'.repeat(4000));
  const emoji = buildRequest(inventoryText, '😀'.repeat(2000));
  const bytes = (request) => new TextEncoder().encode(JSON.stringify(request.messages) + JSON.stringify(request.response_format)).length;
  const rates = MODELS[MODEL];
  for (const request of [ascii, emoji]) {
    const expected = ((bytes(request) + 256) * rates.inputNeuronsPerMillion + LIMITS.maxOutputTokens * rates.outputNeuronsPerMillion) / 1e6;
    assert.ok(Math.abs(estimateNeurons(MODEL, request) - expected) < 1e-9);
  }
  assert.ok(estimateNeurons(MODEL, emoji) > estimateNeurons(MODEL, ascii));
});

test('an unknown model never reaches the AI', async () => {
  const env = makeEnv({ AI_MODEL: '@cf/zai-org/glm-5.3', AI: fakeAI() });
  assert.equal((await send(env)).body.error, 'ai_not_configured');
  assert.equal(env.AI.calls.length, 0);
});

test('a late request stamped before midnight cannot reset the new day', async () => {
  const counters = { minute: -1, minuteCount: 0, perClient: new Map() };
  const storage = memoryStorage();
  const midnight = Date.UTC(2026, 9, 18);
  const input = (now, client) => ({ now, cost: 60, client, dailyLimit: 100, perMinute: 100, perClient: 100 });
  assert.deepEqual(await reserve(counters, storage, input(midnight + 1, 'a')), { ok: true, day: '2026-10-18' });
  assert.deepEqual(await reserve(counters, storage, input(midnight - 1, 'b')), { ok: false, reason: 'daily' });
  assert.deepEqual(await reserve(counters, storage, input(midnight + 2, 'c')), { ok: false, reason: 'daily' });
  assert.deepEqual(storage.values.get('spend'), { day: '2026-10-18', spent: 60 });
});

test('a late request stamped in an earlier minute cannot reset the minute counters', async () => {
  const counters = { minute: -1, minuteCount: 0, perClient: new Map() };
  const storage = memoryStorage();
  const input = (now, client) => ({ now, cost: 1, client, dailyLimit: 1000, perMinute: 2, perClient: 100 });
  assert.equal((await reserve(counters, storage, input(NOW + 60_000, 'a'))).ok, true);
  assert.equal((await reserve(counters, storage, input(NOW + 60_001, 'b'))).ok, true);
  assert.deepEqual(await reserve(counters, storage, input(NOW + 59_999, 'c')), { ok: false, reason: 'minute' });
  assert.deepEqual(await reserve(counters, storage, input(NOW + 60_002, 'd')), { ok: false, reason: 'minute' });
});

