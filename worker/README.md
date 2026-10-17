# Pittsburgh Prop Search scene-matching Worker

This Cloudflare Worker powers the "Paste a scene" box on https://cookiesfilmfest.com/props.

The keyword search on that page runs entirely in the browser and needs no Worker. This Worker adds only the AI step:
1. It sends the scene text and a compact list of the indexed props to one Workers AI model.
2. It checks every item key the model returns against the inventory.
3. It returns props found and not found, split into "required by the scene" and "optional set dressing".

The Worker is served from `*.workers.dev`, because cookiesfilmfest.com's DNS is not on Cloudflare. The page calls it cross-origin, so CORS allows only `https://cookiesfilmfest.com` and `http://localhost:4321`.

## API

`POST /v1/scene` takes a body of `{ "text": "<scene>" }` with `Content-Type: application/json`. The text must be 20–4,000 characters, and the whole body may be at most 16 KiB.

`200` returns this:

```json
{ "ok": true, "model": "@cf/ibm-granite/granite-4.0-h-micro",
  "required": [{ "prop": "rotary phone", "reason": "Margaret answers it", "keys": ["scp-055"] }],
  "optional": [{ "prop": "ashtray", "reason": "1960s office desk dressing", "keys": [] }],
  "ignoredSuggestions": 0, "usage": { "inputTokens": 5210, "outputTokens": 412 }, "chargedNeurons": 50.1 }
```

- `keys` are keys from `src/data/props/inventory.json`. Keys the model invents are dropped and counted in `ignoredSuggestions`. An empty `keys` list means no matching item was found.
- Every error has the shape `{ "ok": false, "error": "<code>", "message": "..." }`:

| Status | Codes |
|---|---|
| 400 | `invalid_json`, `text_required`, `text_too_short` |
| 403 | `origin_not_allowed` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 413 | `payload_too_large`, `text_too_long` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` (with `Retry-After`) |
| 502 | `ai_failed`, `ai_bad_output` |
| 503 | `quota_exhausted` (with `Retry-After`); `ai_busy`; `ai_not_configured`; `ai_unavailable` |
| 504 | `ai_timeout` |

## Cost guard

One SQLite-backed Durable Object, `AiBudget`, controls every AI call. The defaults are vars in `wrangler.jsonc`:

| Var | Default | What it limits |
|---|---|---|
| `DAILY_NEURON_BUDGET` | `5000` | Workers AI Neurons per UTC day. That is half of the account's free daily 10,000. |
| `AI_PER_CLIENT_PER_MINUTE` | `3` | requests per client address per minute |
| `AI_PER_MINUTE_LIMIT` | `20` | requests per minute for everyone |
| `AI_TIMEOUT_MS` | `20000` | how long to wait for the model |

- **Pre-charge.** Before each call, the Worker reserves the worst case: input tokens are bounded by the UTF-8 byte length of everything sent plus 256, and output by `max_tokens` (1,700). Real usage can't exceed what was charged. With granite-4.0-h-micro, a 4,000-character English scene is charged about 50 Neurons, which gives roughly 100 scenes a day.
- **No refunds.** The charge is never refunded, not even when the call fails, times out or reports `ai_busy`. A Workers AI outage during heavy use can therefore use up the day's budget with nothing to show for it. When the budget is gone, scene matching shows "Today's AI matching budget is used up" until midnight UTC, and keyword search keeps working.
- **What is stored.** The object keeps one record, `{ day, spent }`. The per-client and per-minute counters live only in memory, for the current minute. Client addresses are never stored, logged or returned.
- **Fails closed.** A missing or malformed var, an unknown model, or a guard that errors or doesn't answer within 3 s turns the AI off (`ai_not_configured` or `ai_unavailable`). It never runs unguarded.

## Privacy

- Scene text goes only to Workers AI.
- The Worker has no `console` output, Workers Logs are off (`observability.enabled: false`), and there's no AI Gateway, analytics, KV or D1.
- Responses never echo the scene text.

## Tests

`npm test` (here, or the root `npm test`, which includes these files) runs the suite with plain Node and mocks. It needs no install, no network and no Cloudflare account.

## Local development without Cloudflare

```sh
node scripts/dev-server.mjs --ai mock          # canned answer, including one invented key and one prop with no match
node scripts/dev-server.mjs --ai fail          # every AI call fails
node scripts/dev-server.mjs --ai hang --timeout-ms 3000
node scripts/dev-server.mjs --daily-budget 1   # every request hits the daily budget
```

Then, in the repository root:

```sh
PUBLIC_PROPS_API_URL=http://localhost:8787 npm run dev
```

Open http://localhost:4321/props. Pass the variable on the command line only, not in `.env`: Vite also reads `.env` for production builds.

## Deploying

1. `npm ci`
2. `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN`)
3. `npx wrangler deploy`
4. Note the URL, `https://pgh-prop-search.<account-subdomain>.workers.dev`.

Smoke test (the first three spend no AI):

```sh
URL=https://pgh-prop-search.<account-subdomain>.workers.dev
curl -i -X OPTIONS -H "Origin: https://cookiesfilmfest.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" "$URL/v1/scene"   # 204 with CORS headers
curl -i -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{"text":"a scene that is long enough"}' "$URL/v1/scene"   # 403
curl -i -X POST -H "Origin: https://cookiesfilmfest.com" -H "Content-Type: application/json" -d '{"text":"short"}' "$URL/v1/scene"   # 400
curl -s -X POST -H "Origin: https://cookiesfilmfest.com" -H "Content-Type: application/json" -d '{"text":"INT. OFFICE - DAY. A secretary types on a typewriter and answers a rotary phone."}' "$URL/v1/scene"   # 200 with real keys
```

To preview real scene matching on your machine before the site links to the Worker, run this in the repository root:

```sh
PUBLIC_PROPS_API_URL="$URL" npm run dev
```

The site uses the Worker only after `src/data/props/config.json` has `"apiUrl": "<URL>"` and that change is merged. Deploy the Worker again whenever `src/data/props/inventory.json` changes, because the Worker bundles the inventory.

Check the account's Workers plan (Free or Paid) in the Cloudflare dashboard. The guard doesn't depend on it, but only the Free plan hard-stops Workers AI at 10,000 Neurons a day.
