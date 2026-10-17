export const SCENE_LIMITS = { minChars: 20, maxChars: 4000, maxPeriodChars: 40 };
export const SCENE_TIMEOUT_MS = 40_000;
const INVALID = new Set(['invalid_json', 'text_required', 'text_too_short', 'text_too_long', 'payload_too_large', 'period_invalid', 'period_too_long']);

export function checkSceneText(text, period = '') {
  const length = text.trim().length;
  if (length < SCENE_LIMITS.minChars) return `Paste at least ${SCENE_LIMITS.minChars} characters of the scene.`;
  if (length > SCENE_LIMITS.maxChars) return `Paste at most ${SCENE_LIMITS.maxChars.toLocaleString('en-US')} characters of the scene.`;
  if (period.trim().length > SCENE_LIMITS.maxPeriodChars) return `Keep the time period to ${SCENE_LIMITS.maxPeriodChars} characters.`;
  return null;
}

export function eraNote(periodDecades, itemDecades) {
  if (!periodDecades.size || !itemDecades.length || itemDecades.some((decade) => periodDecades.has(decade))) return null;
  return `Stated era ${itemDecades.map((decade) => `${decade}s`).join(', ')} differs from your period.`;
}

function stateFor(response, body, now) {
  if (response.ok && body?.ok === true && Array.isArray(body.required) && Array.isArray(body.optional)) {
    return { kind: 'ok', model: body.model, required: body.required, optional: body.optional, ignored: body.ignoredSuggestions ?? 0 };
  }
  const code = body?.error;
  if (code === 'rate_limited') return { kind: 'rate_limited' };
  if (code === 'ai_busy') return { kind: 'busy' };
  if (code === 'ai_timeout') return { kind: 'timeout' };
  if (code === 'ai_not_configured' || code === 'ai_unavailable') return { kind: 'unavailable' };
  if (INVALID.has(code)) return { kind: 'invalid', message: body.message };
  if (code === 'quota_exhausted') {
    const seconds = Number(response.headers.get('retry-after'));
    return { kind: 'quota', resetsAt: Number.isFinite(seconds) && seconds > 0 ? new Date(now() + seconds * 1000) : null };
  }
  return { kind: 'error' };
}

export async function requestScene(apiUrl, text, { period = '', fetch: send = globalThis.fetch, timeoutMs = SCENE_TIMEOUT_MS, now = Date.now } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await send(`${apiUrl.replace(/\/+$/, '')}/v1/scene`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(period.trim() ? { text: text.trim(), period: period.trim() } : { text: text.trim() }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return stateFor(response, body, now);
  } catch (error) {
    return { kind: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export function keepKnownKeys(state, knownKeys) {
  let dropped = 0;
  const clean = (props) => props.map((entry) => {
    const keys = (Array.isArray(entry.keys) ? entry.keys : []).filter((key) => {
      const known = knownKeys.has(key);
      if (!known) dropped += 1;
      return known;
    });
    return { prop: String(entry.prop ?? ''), reason: String(entry.reason ?? ''), keys };
  });
  const required = clean(state.required);
  const optional = clean(state.optional);
  return { ...state, required, optional, ignored: state.ignored + dropped };
}
