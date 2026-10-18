#!/usr/bin/env node

import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { handleRequest } from '../src/index.js';
import { budgetNamespace } from '../test/helpers.mjs';

const { values } = parseArgs({
  options: {
    ai: { type: 'string', default: 'mock' },
    port: { type: 'string', default: '8787' },
    'daily-budget': { type: 'string', default: '5000' },
    'timeout-ms': { type: 'string', default: '30000' },
    delay: { type: 'string', default: '1500' },
  },
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backends = {
  async mock(model, input) {
    await pause(Number(values.delay));
    const keys = [...input.messages[0].content.matchAll(/^(\S+) \| /gm)].map(([, key]) => key);
    const output = {
      required: [
        { prop: 'first prop', reason: 'Mock answer: the scene names it', keys: keys.slice(0, 2) },
        { prop: 'a prop the catalog lacks', reason: 'Mock answer: nothing in the inventory fits', keys: [] },
        { prop: 'an invented key', reason: 'Mock answer: a key that does not exist', keys: ['scp-000-404'] },
      ],
      optional: [{ prop: 'set dressing', reason: 'Mock answer: suits the setting', keys: keys.slice(2, 4) }],
    };
    return { choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 7000, completion_tokens: 300 } };
  },
  async fail() {
    await pause(Number(values.delay));
    throw new Error('mock failure');
  },
  hang: () => new Promise(() => {}),
};
if (!backends[values.ai]) {
  console.error(`--ai must be one of: ${Object.keys(backends).join(', ')}`);
  process.exit(1);
}

const env = {
  ALLOWED_ORIGINS: 'http://localhost:4321',
  AI_MODEL: '@cf/google/gemma-4-26b-a4b-it',
  DAILY_NEURON_BUDGET: values['daily-budget'],
  AI_PER_MINUTE_LIMIT: '20',
  AI_PER_CLIENT_PER_MINUTE: '3',
  AI_TIMEOUT_MS: values['timeout-ms'],
  AI: { run: backends[values.ai] },
  AI_BUDGET: budgetNamespace(),
};

const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const hasBody = !['GET', 'HEAD'].includes(incoming.method);
  const request = new Request(`http://localhost:${values.port}${incoming.url}`, {
    method: incoming.method,
    headers: incoming.headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
  const response = await handleRequest(request, env);
  let body = await response.text();
  if (response.headers.get('content-type')?.startsWith('application/json')) {
    const parsed = JSON.parse(body);
    if (parsed.model) body = JSON.stringify({ ...parsed, model: `local ${values.ai} AI (dev server)` });
  }
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(body);
});

server.listen(Number(values.port), () => {
  console.log(`Prop search API with a ${values.ai} AI backend at http://localhost:${values.port}/v1/scene`);
});
