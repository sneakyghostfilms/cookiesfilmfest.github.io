import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { privateOutputProblem } from './private-output.mjs';

export const USER_AGENT = 'PittsburghPropSearch/0.1 (private research index for Pittsburgh filmmakers; +https://cookiesfilmfest.com/#contact)';
export const MIN_GAP_MS = 2000;
export const JITTER_MS = 1000;
export const TIMEOUT_MS = 60_000;
const NEVER_CONTACTED = [/(^|\.)retroon8th\.com$/, /(^|\.)myshopify\.com$/];

export class FetchStopped extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FetchStopped';
    Object.assign(this, details);
  }
}

export function cacheName(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

export function hostProblem(url, allowHosts) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return `not a URL: ${url}`;
  }
  if (parsed.protocol !== 'https:') return `only https is fetched: ${url}`;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (NEVER_CONTACTED.some((pattern) => pattern.test(host))) return `${host} is never contacted (see CLAUDE.md, Pittsburgh Prop Search)`;
  if (!allowHosts.includes(host)) return `${host} is not an allowed host for this run`;
  return null;
}

function stopMessage({ url, status, location, retryAfter }) {
  if (status >= 300 && status < 400) return `${url} answered ${status} (redirect to ${location ?? 'nowhere'}); redirects are never followed`;
  if (status === 429 || status === 403) return `${url} answered ${status}${retryAfter ? ` with Retry-After ${retryAfter}` : ''}; stopping as the site asks`;
  return `${url} answered HTTP ${status}`;
}

const MISSING = new Set([401, 403, 404, 410]);

async function readCached(url, files) {
  if (!existsSync(files.meta) || !existsSync(files.body)) return null;
  const meta = JSON.parse(await readFile(files.meta, 'utf8'));
  if (meta.url !== url) throw new FetchStopped(`cache entry ${files.meta} belongs to ${meta.url}, not ${url}`, { url, reason: 'cache' });
  return { body: await readFile(files.body), meta, cached: true, missing: MISSING.has(meta.status) };
}

export function createSiteFetcher({
  allowHosts,
  fetch: send = globalThis.fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  random = Math.random,
  now = Date.now,
  guard = privateOutputProblem,
  timeoutMs = TIMEOUT_MS,
}) {
  let lastFinishedAt = null;
  let gapMs = MIN_GAP_MS;
  let stopped = null;
  let queue = Promise.resolve();
  const stats = { requests: 0, cacheHits: 0 };

  function stop(error) {
    stopped = error;
    throw error;
  }

  async function get(url, directory, { missingOk = false } = {}) {
    const name = cacheName(url);
    const files = { body: join(directory, `${name}.body`), meta: join(directory, `${name}.meta.json`) };
    const problem = hostProblem(url, allowHosts);
    if (problem) stop(new FetchStopped(problem, { url, reason: 'refused' }));
    const cached = await readCached(url, files);
    if (cached?.missing && !missingOk) stop(new FetchStopped(`${url} answered HTTP ${cached.meta.status} (cached)`, { url, status: cached.meta.status }));
    if (cached) {
      stats.cacheHits += 1;
      return cached;
    }
    if (stopped) throw stopped;
    const unsafe = guard(directory);
    if (unsafe) stop(new FetchStopped(`refusing to cache vendor content: ${unsafe}`, { url, reason: 'guard' }));
    if (lastFinishedAt !== null) {
      const wait = lastFinishedAt + gapMs + Math.floor(random() * JITTER_MS) - now();
      if (wait > 0) await sleep(wait);
    }
    stats.requests += 1;
    let response;
    let body;
    try {
      response = await send(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if ((response.status >= 200 && response.status <= 299) || (missingOk && MISSING.has(response.status))) body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      const cause = error.cause?.code ?? error.cause?.message;
      stop(new FetchStopped(`${url} could not be fetched: ${error.message}${cause ? ` (${cause})` : ''}`, { url, reason: 'network' }));
    } finally {
      lastFinishedAt = now();
    }
    if (!body) {
      const details = { url, status: response.status, location: response.headers.get('location'), retryAfter: response.headers.get('retry-after') };
      stop(new FetchStopped(stopMessage(details), details));
    }
    const meta = { url, status: response.status, contentType: response.headers.get('content-type'), fetchedAt: new Date(now()).toISOString() };
    await mkdir(directory, { recursive: true });
    await writeFile(files.body, body);
    await writeFile(files.meta, `${JSON.stringify(meta, null, 1)}\n`);
    return { body, meta, cached: false, missing: MISSING.has(response.status) };
  }

  return {
    get(url, directory, options) {
      const result = queue.then(() => get(url, directory, options));
      queue = result.catch(() => undefined);
      return result;
    },
    raiseGap(ms) {
      gapMs = Math.max(gapMs, Math.ceil(ms));
    },
    stats: () => ({ ...stats }),
  };
}
