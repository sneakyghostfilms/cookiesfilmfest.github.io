import assert from 'node:assert/strict';
import test from 'node:test';
import { settle } from '../src/budget.js';
import { handleRequest } from '../src/index.js';
import { prepareScene } from '../src/inventory.js';
import { MODELS, estimateNeurons } from '../src/scene.js';
import { MODEL, NOW, SCENE, answer, budgetNamespace, fakeAI, fixedClock, goodOutput, makeEnv, memoryStorage, sceneRequest } from './helpers.mjs';

const USAGE = { prompt_tokens: 3000, completion_tokens: 450 };
const RESERVED = estimateNeurons(MODEL, prepareScene(SCENE).request);
const DAY = new Date(NOW).toISOString().slice(0, 10);
const priced = (input, output) => (input * MODELS[MODEL].inputNeuronsPerMillion + output * MODELS[MODEL].outputNeuronsPerMillion) / 1e6;
const tenths = (value) => Math.round(value * 10) / 10;
const spent = (env) => env.AI_BUDGET.storage.values.get('spend').spent;

async function send(env, { ip, now } = {}) {
  const response = await handleRequest(sceneRequest(SCENE, { ip }), env, fixedClock(now));
  return { status: response.status, body: await response.json() };
}

test('a successful answer settles the reservation down to the reported usage', async () => {
  const env = makeEnv({ AI: fakeAI(() => answer(goodOutput(), USAGE)) });
  const { status, body } = await send(env);
  assert.equal(status, 200);
  assert.deepEqual(env.AI_BUDGET.actions, ['/reserve', '/settle']);
  assert.ok(Math.abs(spent(env) - priced(3000, 450)) < 1e-9);
  assert.equal(body.chargedNeurons, tenths(priced(3000, 450)));
  assert.ok(body.chargedNeurons < RESERVED);
});

test('reported reasoning tokens are charged as output tokens', async () => {
  const usage = { ...USAGE, completion_tokens_details: { reasoning_tokens: 300 } };
  const env = makeEnv({ AI: fakeAI(() => answer(goodOutput(), usage)) });
  await send(env);
  assert.ok(Math.abs(spent(env) - priced(3000, 750)) < 1e-9);
});

test('settled spend leaves room for more requests than the worst case would', async () => {
  const env = makeEnv({
    AI: fakeAI(() => answer(goodOutput(), USAGE)),
    DAILY_NEURON_BUDGET: String(Math.ceil(RESERVED * 2) + 1),
    AI_PER_CLIENT_PER_MINUTE: '100',
    AI_PER_MINUTE_LIMIT: '100',
  });
  const statuses = [];
  for (let index = 0; index < 6; index += 1) statuses.push((await send(env, { ip: `192.0.2.${index}` })).status);
  assert.ok(statuses.filter((status) => status === 200).length > 2, statuses.join(' '));
});

test('no failure path settles, so the worst-case charge stands', async () => {
  const failures = [
    ['ai_failed', () => { throw new Error('boom'); }],
    ['ai_timeout', () => new Promise(() => {})],
    ['ai_busy', () => { throw new Error('3040: Capacity temporarily exceeded'); }],
    ['quota_exhausted', () => { throw new Error('3036: Account limited'); }],
    ['ai_not_configured', () => { throw new Error('5007: No such model'); }],
    ['ai_bad_output', () => ({ choices: [{ message: { content: 'Here are some props.' } }], usage: USAGE })],
    ['ai_bad_output', () => answer({ required: 'phone', optional: [] }, USAGE)],
  ];
  for (const [error, respond] of failures) {
    const env = makeEnv({ AI: fakeAI(respond), AI_TIMEOUT_MS: '10' });
    const { status, body } = await send(env);
    assert.equal(body.error, error);
    assert.notEqual(status, 200);
    assert.deepEqual(env.AI_BUDGET.actions, ['/reserve'], error);
    assert.ok(Math.abs(spent(env) - RESERVED) < 1e-9, error);
  }
});

test('missing or malformed usage skips the settle', async () => {
  const usages = [
    undefined,
    {},
    { prompt_tokens: 3000 },
    { prompt_tokens: '7000', completion_tokens: 450 },
    { prompt_tokens: 0, completion_tokens: 450 },
    { prompt_tokens: -1, completion_tokens: 450 },
    { prompt_tokens: 3000.5, completion_tokens: 450 },
    { ...USAGE, completion_tokens_details: { reasoning_tokens: 'many' } },
  ];
  for (const usage of usages) {
    const env = makeEnv({ AI: fakeAI(() => answer(goodOutput(), usage)) });
    const { status, body } = await send(env);
    assert.equal(status, 200, JSON.stringify(usage));
    assert.deepEqual(env.AI_BUDGET.actions, ['/reserve'], JSON.stringify(usage));
    assert.equal(body.chargedNeurons, tenths(RESERVED));
  }
});

test('a settle that fails, hangs or answers nonsense leaves the 200 and the worst-case charge', async () => {
  const broken = [
    async () => { throw new Error('object reset'); },
    () => new Promise(() => {}),
    async () => new Response('not json'),
    async () => Response.json(null),
    async () => Response.json({ ok: true, refunded: -5 }),
    async () => Response.json({ ok: true, refunded: RESERVED * 2 }),
  ];
  for (const settleFetch of broken) {
    const budget = budgetNamespace();
    const real = budget.get();
    const flaky = { fetch: (url, init) => (new URL(url).pathname === '/settle' ? settleFetch() : real.fetch(url, init)) };
    const env = makeEnv({ AI: fakeAI(() => answer(goodOutput(), USAGE)), AI_BUDGET: { ...budget, get: () => flaky } });
    const { status, body } = await send(env);
    assert.equal(status, 200);
    assert.deepEqual(body.required.map((prop) => prop.keys), [['scp-056'], ['scp-051']]);
    assert.equal(body.chargedNeurons, tenths(RESERVED));
  }
});

test('settling never raises spend, never goes below zero and never refunds more than the reservation', async () => {
  const storage = memoryStorage();
  await storage.put('spend', { day: DAY, spent: 300 });
  assert.deepEqual(await settle(storage, { day: DAY, reserved: 200, actual: 250 }), { ok: true, refunded: 0 });
  assert.equal(storage.values.get('spend').spent, 300);
  assert.deepEqual(await settle(storage, { day: DAY, reserved: 200, actual: 50 }), { ok: true, refunded: 150 });
  assert.equal(storage.values.get('spend').spent, 150);
  await storage.put('spend', { day: DAY, spent: 40 });
  assert.deepEqual(await settle(storage, { day: DAY, reserved: 200, actual: 0 }), { ok: true, refunded: 40 });
  assert.equal(storage.values.get('spend').spent, 0);
});

test('a settle for a reservation made on an earlier UTC day leaves the new day alone', async () => {
  const storage = memoryStorage();
  const nextDay = new Date(NOW + 86_400_000).toISOString().slice(0, 10);
  await storage.put('spend', { day: nextDay, spent: 210 });
  assert.deepEqual(await settle(storage, { day: DAY, reserved: 200, actual: 70 }), { ok: true, refunded: 0 });
  assert.equal(storage.values.get('spend').spent, 210);
});

test('a late request stamped before midnight is charged and settled on the new day', async () => {
  const midnight = Date.UTC(2026, 9, 18);
  const env = makeEnv({ AI: fakeAI(() => answer(goodOutput(), USAGE)), AI_PER_CLIENT_PER_MINUTE: '100' });
  assert.equal((await send(env, { ip: '192.0.2.1', now: midnight + 1 })).status, 200);
  assert.equal((await send(env, { ip: '192.0.2.2', now: midnight - 1 })).status, 200);
  const record = env.AI_BUDGET.storage.values.get('spend');
  assert.equal(record.day, '2026-10-18');
  assert.ok(Math.abs(record.spent - 2 * priced(3000, 450)) < 1e-9, String(record.spent));
});

test('the budget object refuses malformed settle input and unknown actions without writing', async () => {
  const budget = budgetNamespace();
  const inputs = [
    null, {}, { day: DAY, reserved: 200 }, { day: DAY, reserved: 200, actual: -1 }, { day: DAY, reserved: 0, actual: 5 },
    { day: DAY, reserved: 200, actual: Number.NaN }, { day: DAY, reserved: '200', actual: 5 },
    { now: NOW, reserved: 200, actual: 5 }, { day: 'yesterday', reserved: 200, actual: 5 },
  ];
  for (const input of inputs) {
    const response = await budget.get().fetch('https://budget/settle', { method: 'POST', body: JSON.stringify(input) });
    assert.equal(response.status, 400, JSON.stringify(input));
  }
  const unknown = await budget.get().fetch('https://budget/refund', { method: 'POST', body: JSON.stringify({ day: DAY, reserved: 200, actual: 5 }) });
  assert.equal(unknown.status, 400);
  assert.equal(budget.storage.writes.length, 0);
});
