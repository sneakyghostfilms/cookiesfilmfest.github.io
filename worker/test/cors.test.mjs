import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { ORIGIN, fixedClock, makeEnv, sceneRequest } from './helpers.mjs';

function preflight(origin, { method = 'POST', headers = 'content-type' } = {}) {
  return new Request('https://pgh-prop-search.example.workers.dev/v1/scene', {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': headers },
  });
}

test('preflight from an allowed origin is answered with exact CORS headers', async () => {
  for (const origin of [ORIGIN, 'http://localhost:4321']) {
    const response = await handleRequest(preflight(origin), makeEnv(), fixedClock());
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(response.headers.get('access-control-max-age'), '86400');
    assert.equal(response.headers.get('vary'), 'Origin');
  }
});

test('preflight from another origin, method or header set is refused without CORS headers', async () => {
  const refused = [
    preflight('https://evil.example'),
    preflight('https://www.cookiesfilmfest.com'),
    preflight('http://localhost:4322'),
    preflight(ORIGIN, { method: 'PUT' }),
    preflight(ORIGIN, { headers: 'content-type, authorization' }),
  ];
  for (const request of refused) {
    const response = await handleRequest(request, makeEnv(), fixedClock());
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('a POST from a disallowed or missing origin is refused before any AI work', async () => {
  for (const origin of ['https://evil.example', null]) {
    const env = makeEnv();
    const response = await handleRequest(sceneRequest(undefined, { origin }), env, fixedClock());
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await response.json()).error, 'origin_not_allowed');
    assert.equal(env.AI.calls.length, 0);
    assert.equal(env.AI_BUDGET.storage.writes.length, 0);
  }
});

test('responses to an allowed origin carry its CORS header', async () => {
  const response = await handleRequest(sceneRequest(), makeEnv(), fixedClock());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-expose-headers'), 'Retry-After');
});
