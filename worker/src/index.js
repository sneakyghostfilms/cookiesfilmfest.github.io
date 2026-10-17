import { inventoryKeys, inventoryText } from './inventory.js';
import { LIMITS, MODELS, buildRequest, estimateNeurons, readModelOutput, validateScene } from './scene.js';

export { AiBudget } from './budget.js';

const GUARD_TIMEOUT_MS = 3000;
const NOT_CONFIGURED_CODES = new Set([5035, 5016, 5007, 3042, 3023, 5018, 3041]);
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const MESSAGES = {
  not_found: 'There is nothing here.',
  method_not_allowed: 'Use POST.',
  origin_not_allowed: 'This site is not allowed to use the prop search API.',
  unsupported_media_type: 'Send JSON.',
  payload_too_large: 'The request is too large.',
  invalid_json: 'The request is not valid JSON.',
  text_required: 'Send the scene as {"text": "..."}.',
  text_too_short: `Paste at least ${LIMITS.minTextChars} characters of the scene.`,
  text_too_long: `Paste at most ${LIMITS.maxTextChars} characters of the scene.`,
  rate_limited: 'Too many requests right now. Wait a minute and try again.',
  quota_exhausted: "Today's AI matching budget is used up. It resets at midnight UTC.",
  ai_busy: 'The AI service is busy. Try again in a minute.',
  ai_not_configured: 'AI matching is not available right now.',
  ai_unavailable: 'AI matching is not available right now.',
  ai_timeout: 'The AI took too long to answer.',
  ai_failed: 'AI matching did not work this time.',
  ai_bad_output: 'The AI answer could not be used.',
};
const STATUS = {
  ai_busy: 503, ai_not_configured: 503, ai_unavailable: 503, quota_exhausted: 503, ai_timeout: 504, ai_failed: 502, ai_bad_output: 502,
};

class TimeoutError extends Error {}

function reply(status, body, origin, headers = {}) {
  const cors = origin ? { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'Retry-After', vary: 'Origin' } : {};
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors, ...headers } });
}

function failure(status, error, origin, headers) {
  return reply(status, { ok: false, error, message: MESSAGES[error] }, origin, headers);
}

function positive(value) {
  const number = Number(value);
  return value !== '' && value !== null && Number.isFinite(number) && number > 0 ? number : null;
}

export function readConfig(env) {
  const config = {
    model: env.AI_MODEL,
    dailyLimit: positive(env.DAILY_NEURON_BUDGET),
    perMinute: positive(env.AI_PER_MINUTE_LIMIT),
    perClient: positive(env.AI_PER_CLIENT_PER_MINUTE),
    timeoutMs: positive(env.AI_TIMEOUT_MS),
  };
  const complete = Object.values(config).every((value) => value !== null && value !== undefined);
  return complete && Object.hasOwn(MODELS, config.model) && env.AI && env.AI_BUDGET ? config : null;
}

function preflight(request, origin) {
  const method = request.headers.get('access-control-request-method');
  const headers = (request.headers.get('access-control-request-headers') ?? '')
    .split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (!origin || method !== 'POST' || headers.some((name) => name !== 'content-type')) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin',
    },
  });
}

async function readBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function aiErrorCode(error) {
  const code = Number(error?.code);
  if (Number.isInteger(code) && code >= 1000) return code;
  const match = String(error?.message ?? '').match(/\b([35]\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function aiFailure(error) {
  if (error instanceof TimeoutError) return 'ai_timeout';
  const code = aiErrorCode(error);
  if (code === 3036) return 'quota_exhausted';
  if (code === 3040) return 'ai_busy';
  if (code === 3007 || code === 3008) return 'ai_timeout';
  if (NOT_CONFIGURED_CODES.has(code)) return 'ai_not_configured';
  return 'ai_failed';
}

function secondsUntilUtcMidnight(now) {
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.ceil((midnight.getTime() - now) / 1000);
}

async function reserveBudget(env, input) {
  const stub = env.AI_BUDGET.get(env.AI_BUDGET.idFromName('global'));
  const response = await stub.fetch('https://budget/reserve', { method: 'POST', body: JSON.stringify(input) });
  return response.json();
}

function usageOf(result) {
  const usage = result?.usage;
  if (!usage) return undefined;
  return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
}

export async function handleRequest(request, env, { now: clock = Date.now, guardTimeoutMs = GUARD_TIMEOUT_MS } = {}) {
  const { pathname } = new URL(request.url);
  const requestOrigin = request.headers.get('origin');
  const allowedOrigins = String(env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim());
  const origin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
  if (pathname !== '/v1/scene') return failure(404, 'not_found', origin);
  if (request.method === 'OPTIONS') return preflight(request, origin);
  if (request.method !== 'POST') return failure(405, 'method_not_allowed', origin, { allow: 'POST, OPTIONS' });
  if (!origin) return failure(403, 'origin_not_allowed', null);
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return failure(415, 'unsupported_media_type', origin);

  const raw = await readBody(request, LIMITS.maxBodyBytes);
  if (raw === null) return failure(413, 'payload_too_large', origin);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure(400, 'invalid_json', origin);
  }
  if (typeof body?.text !== 'string') return failure(400, 'text_required', origin);
  const text = body.text.trim();
  if (text.length < LIMITS.minTextChars) return failure(400, 'text_too_short', origin);
  if (text.length > LIMITS.maxTextChars) return failure(413, 'text_too_long', origin);

  const config = readConfig(env);
  if (!config) return failure(503, 'ai_not_configured', origin);
  const aiRequest = buildRequest(inventoryText, text);
  const cost = estimateNeurons(config.model, aiRequest);
  const now = clock();
  let reservation;
  try {
    reservation = await withTimeout(reserveBudget(env, {
      now, cost, client: request.headers.get('cf-connecting-ip') ?? 'unknown',
      dailyLimit: config.dailyLimit, perMinute: config.perMinute, perClient: config.perClient,
    }), guardTimeoutMs);
  } catch {
    return failure(503, 'ai_unavailable', origin);
  }
  if (reservation?.ok !== true) {
    if (reservation?.reason === 'daily') return failure(503, 'quota_exhausted', origin, { 'retry-after': String(secondsUntilUtcMidnight(now)) });
    if (reservation?.reason === 'client' || reservation?.reason === 'minute') return failure(429, 'rate_limited', origin, { 'retry-after': '60' });
    return failure(503, 'ai_unavailable', origin);
  }

  let result;
  try {
    result = await withTimeout(env.AI.run(config.model, aiRequest), config.timeoutMs);
  } catch (error) {
    const kind = aiFailure(error);
    const retry = kind === 'quota_exhausted' ? String(secondsUntilUtcMidnight(now)) : kind === 'ai_busy' ? '60' : null;
    return failure(STATUS[kind], kind, origin, retry ? { 'retry-after': retry } : {});
  }
  let scene;
  try {
    scene = validateScene(readModelOutput(result), inventoryKeys);
  } catch {
    return failure(502, 'ai_bad_output', origin);
  }
  return reply(200, { ok: true, model: config.model, ...scene, usage: usageOf(result), chargedNeurons: Math.round(cost * 10) / 10 }, origin);
}

export default {
  fetch: (request, env) => handleRequest(request, env),
};
