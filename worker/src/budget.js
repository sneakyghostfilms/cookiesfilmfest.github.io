const SPEND_KEY = 'spend';

export function isReserveInput(input) {
  const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  return Boolean(input) && positive(input.now) && positive(input.cost) && positive(input.dailyLimit)
    && positive(input.perMinute) && positive(input.perClient) && typeof input.client === 'string' && input.client.length <= 64;
}

export async function reserve(counters, storage, { now, cost, client, dailyLimit, perMinute, perClient }) {
  const minute = Math.floor(now / 60_000);
  if (counters.minute !== minute) {
    counters.minute = minute;
    counters.minuteCount = 0;
    counters.perClient = new Map();
  }
  const clientCount = counters.perClient.get(client) ?? 0;
  if (clientCount >= perClient) return { ok: false, reason: 'client' };
  if (counters.minuteCount >= perMinute) return { ok: false, reason: 'minute' };
  const day = new Date(now).toISOString().slice(0, 10);
  const record = await storage.get(SPEND_KEY);
  const spent = record?.day === day ? record.spent : 0;
  if (spent + cost > dailyLimit) return { ok: false, reason: 'daily' };
  await storage.put(SPEND_KEY, { day, spent: spent + cost });
  counters.minuteCount += 1;
  counters.perClient.set(client, clientCount + 1);
  return { ok: true };
}

export class AiBudget {
  constructor(state) {
    this.storage = state.storage;
    this.counters = { minute: -1, minuteCount: 0, perClient: new Map() };
    this.queue = Promise.resolve();
  }

  async fetch(request) {
    const input = await request.json().catch(() => null);
    if (!isReserveInput(input)) return Response.json({ ok: false, reason: 'invalid' }, { status: 400 });
    const result = this.queue.then(() => reserve(this.counters, this.storage, input));
    this.queue = result.catch(() => undefined);
    return Response.json(await result);
  }
}
