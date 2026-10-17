import { AiBudget } from '../src/budget.js';

export const ORIGIN = 'https://cookiesfilmfest.com';
export const SCENE = 'INT. INSURANCE OFFICE - DAY. Margaret counts coins at the green change machine and answers the phone.';
export const NOW = Date.UTC(2026, 9, 17, 16, 0, 0);

export function memoryStorage() {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    async get(key) {
      return structuredClone(values.get(key));
    },
    async put(key, value) {
      writes.push([key, structuredClone(value)]);
      values.set(key, structuredClone(value));
    },
  };
}

export function budgetNamespace(storage = memoryStorage()) {
  const object = new AiBudget({ storage });
  const stub = { fetch: (url, init) => object.fetch(new Request(url, init)) };
  return { storage, object, idFromName: (name) => name, get: () => stub };
}

export function fakeAI(respond = () => ({ response: JSON.stringify(goodOutput()) })) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return respond(model, input, calls.length);
    },
  };
}

export function goodOutput() {
  return {
    required: [
      { prop: 'change machine', reason: 'Margaret counts coins at it', keys: ['scp-056'] },
      { prop: 'telephone', reason: 'She answers the phone', keys: ['scp-051', 'scp-999'] },
    ],
    optional: [{ prop: 'adding machine', reason: '1960s office desk dressing', keys: ['scp-025'] }],
  };
}

export function makeEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: 'https://cookiesfilmfest.com,http://localhost:4321',
    AI_MODEL: '@cf/ibm-granite/granite-4.0-h-micro',
    DAILY_NEURON_BUDGET: '5000',
    AI_PER_MINUTE_LIMIT: '20',
    AI_PER_CLIENT_PER_MINUTE: '3',
    AI_TIMEOUT_MS: '20000',
    AI: fakeAI(),
    AI_BUDGET: budgetNamespace(),
    ...overrides,
  };
}

export function sceneRequest(text = SCENE, { origin = ORIGIN, ip = '203.0.113.7', headers = {}, body, method = 'POST', path = '/v1/scene' } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers } };
  if (origin) init.headers.origin = origin;
  if (method !== 'GET' && method !== 'HEAD') init.body = body ?? JSON.stringify({ text });
  if (init.body instanceof ReadableStream) init.duplex = 'half';
  return new Request(`https://pgh-prop-search.example.workers.dev${path}`, init);
}

export const fixedClock = (now = NOW) => ({ now: () => now, guardTimeoutMs: 10 });
