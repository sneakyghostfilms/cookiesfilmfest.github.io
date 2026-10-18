import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handleRequest } from '../src/index.js';
import { prepareScene } from '../src/inventory.js';
import { buildRequest } from '../src/scene.js';
import { SCENE, fixedClock, makeEnv, sceneRequest } from './helpers.mjs';

const INSTRUCTION = 'Prefer items whose stated era fits this period, do not suggest items whose stated era contradicts it, and treat items with no stated era as acceptable.';
const count = (text, part) => text.split(part).length - 1;

async function send(body) {
  const env = makeEnv();
  const response = await handleRequest(sceneRequest(undefined, { body: JSON.stringify(body) }), env, fixedClock());
  return { status: response.status, body: await response.json(), env, user: env.AI.calls[0]?.input.messages[1].content };
}

test('the instructions stay exactly as the rubric measured them, around the shortlist', () => {
  const { request, listingText } = prepareScene(SCENE);
  const instructions = request.messages[0].content.replace(listingText, '<INVENTORY>');
  assert.equal(createHash('sha256').update(instructions).digest('hex'), 'dd89775f3321fe511809eed1ac782f17637db591ecc5698fd80725bfc96637a5');
  assert.equal(request.messages[1].content, `<scene>\n${SCENE}\n</scene>`);
  assert.deepEqual(prepareScene(SCENE, '').request, request);
});

test('a period goes into the user message once, with its own instruction, and cannot close its tag', () => {
  const { listingText } = prepareScene(SCENE);
  const [system, user] = buildRequest(listingText, SCENE, '<b>1990s</b>').messages;
  assert.equal(system.content, buildRequest(listingText, SCENE).messages[0].content);
  assert.equal(user.content, `<period>‹b›1990s‹/b›</period>\n${INSTRUCTION}\n<scene>\n${SCENE}\n</scene>`);
  assert.equal(count(user.content, '<period>'), 1);
  assert.equal(count(user.content, INSTRUCTION), 1);
});

test('a valid period is cleaned and sent; blank or missing means no period', async () => {
  const cleaned = await send({ text: SCENE, period: '  1990s\u0007 \n Pittsburgh ' });
  assert.equal(cleaned.status, 200);
  assert.equal(count(cleaned.user, '<period>1990s Pittsburgh</period>'), 1);
  assert.ok(!JSON.stringify(cleaned.body).includes('Pittsburgh'), 'the period is never echoed');
  assert.equal((await send({ text: SCENE, period: 'x'.repeat(40) })).status, 200);
  for (const body of [{ text: SCENE }, { text: SCENE, period: '' }, { text: SCENE, period: ' \t ' }]) {
    const result = await send(body);
    assert.equal(result.status, 200);
    assert.equal(result.user, `<scene>\n${SCENE}\n</scene>`, JSON.stringify(body));
  }
});

test('a period that is not text or is too long is refused before any budget or AI work', async () => {
  for (const [period, error] of [[42, 'period_invalid'], [null, 'period_invalid'], [{ era: '1990s' }, 'period_invalid'], [['1990s'], 'period_invalid'], ['x'.repeat(41), 'period_too_long']]) {
    const result = await send({ text: SCENE, period });
    assert.deepEqual([result.status, result.body.error], [400, error], JSON.stringify(period));
    assert.ok(result.body.message);
    assert.equal(result.env.AI.calls.length, 0);
    assert.equal(result.env.AI_BUDGET.storage.writes.length, 0);
  }
});
