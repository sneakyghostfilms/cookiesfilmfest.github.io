import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { fixedClock, makeEnv, sceneRequest } from './helpers.mjs';

async function expectRefusal(request, status, error) {
  const env = makeEnv();
  const response = await handleRequest(request, env, fixedClock());
  assert.equal(response.status, status, error);
  assert.equal((await response.json()).error, error);
  assert.equal(env.AI.calls.length, 0, `${error}: AI must not be called`);
  assert.equal(env.AI_BUDGET.storage.writes.length, 0, `${error}: no budget may be spent`);
}

function streamOf(totalBytes, chunkBytes = 4096) {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      controller.enqueue(new TextEncoder().encode('x'.repeat(size)));
    },
  });
}

test('unknown paths and methods are refused', async () => {
  await expectRefusal(sceneRequest(undefined, { path: '/v1/other' }), 404, 'not_found');
  await expectRefusal(sceneRequest(undefined, { method: 'GET' }), 405, 'method_not_allowed');
});

test('only JSON bodies are accepted', async () => {
  await expectRefusal(sceneRequest(undefined, { headers: { 'content-type': 'text/plain' } }), 415, 'unsupported_media_type');
});

test('oversized bodies are refused by declared length and by a capped stream read', async () => {
  await expectRefusal(sceneRequest(undefined, { headers: { 'content-length': '20000' } }), 413, 'payload_too_large');
  await expectRefusal(sceneRequest(undefined, { body: streamOf(20 * 1024) }), 413, 'payload_too_large');
});

test('the scene text must be present and within limits', async () => {
  await expectRefusal(sceneRequest(undefined, { body: '{"text": ' }), 400, 'invalid_json');
  await expectRefusal(sceneRequest(undefined, { body: '{"scene": "a long enough scene description here"}' }), 400, 'text_required');
  await expectRefusal(sceneRequest(undefined, { body: '{"text": 42}' }), 400, 'text_required');
  await expectRefusal(sceneRequest('   short scene   '), 400, 'text_too_short');
  await expectRefusal(sceneRequest('x'.repeat(4001)), 413, 'text_too_long');
});

test('a scene at the length limit is accepted', async () => {
  const response = await handleRequest(sceneRequest('x'.repeat(4000)), makeEnv(), fixedClock());
  assert.equal(response.status, 200);
});
