import assert from 'node:assert/strict';
import test from 'node:test';
import { aiErrorCode, handleRequest } from '../src/index.js';
import { NOW, fakeAI, fixedClock, makeEnv, sceneRequest } from './helpers.mjs';

function throwing(error) {
  return fakeAI(() => {
    throw error;
  });
}

async function outcome(ai, overrides = {}) {
  const env = makeEnv({ AI: ai, ...overrides });
  const response = await handleRequest(sceneRequest(), env, fixedClock());
  return { status: response.status, error: (await response.json()).error, retryAfter: response.headers.get('retry-after'), calls: ai.calls.length };
}

test('Workers AI error codes map to the right state, read from the code or the message', async () => {
  const cases = [
    [3036, 503, 'quota_exhausted'], [3040, 503, 'ai_busy'], [3007, 504, 'ai_timeout'], [3008, 504, 'ai_timeout'],
    [5035, 503, 'ai_not_configured'], [5016, 503, 'ai_not_configured'], [5007, 503, 'ai_not_configured'],
    [3042, 503, 'ai_not_configured'], [3023, 503, 'ai_not_configured'], [5018, 503, 'ai_not_configured'],
    [3041, 503, 'ai_not_configured'], [3006, 502, 'ai_failed'], [9999, 502, 'ai_failed'],
  ];
  for (const [code, status, error] of cases) {
    for (const thrown of [Object.assign(new Error('upstream failure'), { code }), new Error(`AiError: ${code}: upstream failure`)]) {
      const result = await outcome(throwing(thrown));
      assert.deepEqual([result.status, result.error, result.calls], [status, error, 1], `${code} via ${thrown.code ? 'code' : 'message'}`);
    }
  }
});

test('quota and busy errors say when to come back', async () => {
  const quota = await outcome(throwing(new Error('3036: Account limited')));
  assert.equal(Number(quota.retryAfter), Math.ceil((Date.UTC(2026, 9, 18) - NOW) / 1000));
  assert.equal((await outcome(throwing(new Error('3040: Capacity temporarily exceeded')))).retryAfter, '60');
});

test('an unrelated number in an error message cannot pick the state', () => {
  assert.equal(aiErrorCode(new Error('timeout after 1500 ms talking to 10.3.40.2')), null);
  assert.equal(aiErrorCode(new Error('request 12345: 3040 capacity')), 3040);
  assert.equal(aiErrorCode(Object.assign(new Error('see 5007'), { code: 3036 })), 3036);
});

test('an AI call that never answers times out without a retry', async () => {
  const hanging = fakeAI(() => new Promise(() => {}));
  const result = await outcome(hanging, { AI_TIMEOUT_MS: '10' });
  assert.deepEqual([result.status, result.error, result.calls], [504, 'ai_timeout', 1]);
});

test('the AI is called exactly once per request, whatever happens', async () => {
  for (const ai of [throwing(new Error('boom')), fakeAI(() => ({ response: 'not json' })), fakeAI()]) {
    assert.equal((await outcome(ai)).calls, 1);
  }
});
