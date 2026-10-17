import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { fakeAI, fixedClock, makeEnv, sceneRequest } from './helpers.mjs';

const SECRET_SCENE = 'INT. VAULT - NIGHT. Codename BLUEBIRD-7731 opens the safe with a rotary phone and a megaphone.';
const IP = '198.51.100.77';

test('scene text and client addresses never reach the console or the response', async (t) => {
  const printed = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    t.mock.method(console, method, (...args) => printed.push(args.map(String).join(' ')));
  }
  const environments = [
    makeEnv(),
    makeEnv({ AI: fakeAI(() => { throw new Error('5007: No such model'); }) }),
    makeEnv({ AI: fakeAI(() => ({ response: 'not json' })) }),
    makeEnv({ AI_PER_CLIENT_PER_MINUTE: '1' }),
  ];
  for (const env of environments) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await handleRequest(sceneRequest(SECRET_SCENE, { ip: IP }), env, fixedClock());
      const body = await response.text();
      assert.ok(!body.includes('BLUEBIRD'), 'response echoes the scene');
      assert.ok(!body.includes(IP), 'response echoes the client address');
    }
  }
  assert.deepEqual(printed, []);
});

test('the scene reaches only the AI call', async () => {
  const env = makeEnv();
  await handleRequest(sceneRequest(SECRET_SCENE, { ip: IP }), env, fixedClock());
  assert.ok(env.AI.calls[0].input.messages[1].content.includes('BLUEBIRD-7731'));
  for (const [, value] of env.AI_BUDGET.storage.writes) assert.ok(!JSON.stringify(value).includes('BLUEBIRD'));
});
