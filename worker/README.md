# Pittsburgh Prop Search scene-matching Worker

This Cloudflare Worker powers the "Paste a scene" box on https://cookiesfilmfest.com/props.

The keyword search on that page runs entirely in the browser and needs no Worker. This Worker adds only the AI step:
1. It ranks the inventory against the scene text with the page's own keyword ranking and keeps 100 items: each scene word's best match first, then the best overall. This is the shortlist (see Shortlist below).
2. It sends the scene text and the shortlist to one Workers AI model, `@cf/google/gemma-4-26b-a4b-it`, with thinking off.
3. It checks every item key the model returns against the shortlist it sent.
4. It returns props found and not found, split into "required by the scene" (at most 12) and "optional set dressing" (at most 4).

The Worker is served from `*.workers.dev`, because cookiesfilmfest.com's DNS is not on Cloudflare. The page calls it cross-origin, so CORS allows only `https://cookiesfilmfest.com` and `http://localhost:4321`.

## API

`POST /v1/scene` takes a body of `{ "text": "<scene>", "period": "1960s" }` with `Content-Type: application/json`.
- The text must be 20–4,000 characters, and the whole body may be at most 16 KiB.
- `period` is optional: a time period or setting of at most 40 characters, after control characters are stripped and the value is trimmed. It must be a string; a blank value counts as no period.
- When a period is given, items whose stated era contradicts it are left out of the shortlist (see Shortlist). The user message also carries the period as `<period>…</period>`, with `<` and `>` neutralized like the scene, and adds one instruction: prefer items whose stated era fits, never suggest one whose stated era contradicts it, and treat items with no stated era as acceptable.
- The system prompt's instructions are the ones the model rubric measured; a test pins them by hash. Only the item list between the header and the instructions changes from scene to scene.
- Like the scene text, the period is never stored, logged or echoed.

`200` returns this:

```json
{ "ok": true, "model": "@cf/google/gemma-4-26b-a4b-it",
  "required": [{ "prop": "black rotary phone", "reason": "Margaret answers it", "keys": ["scp-296"] },
               { "prop": "fax machine", "reason": "She waits by it for the Erie office", "keys": [] }],
  "optional": [{ "prop": "globe decor", "reason": "Suits a 1960s office", "keys": ["scp-038"] }],
  "ignoredSuggestions": 0, "usage": { "inputTokens": 6762, "outputTokens": 556 }, "chargedNeurons": 76.6 }
```

- `keys` are keys from `src/data/props/inventory.json` that were on the shortlist sent with this scene. Keys the model invents, or takes from outside the shortlist, are dropped and counted in `ignoredSuggestions`. An empty `keys` list means no matching item was found on the shortlist.
- The model usually lists props the catalog lacks with an empty `keys` list, but it can leave some out, and a scene that names more props than the lists hold gets matches for only some of them. The page therefore says under every answer: "The AI chose from the catalog items whose words match your scene. Props not listed above were not identified or have no match among them; try keyword search for them."
- `chargedNeurons` is what the request finally cost the daily budget (see Cost guard).
- Every error has the shape `{ "ok": false, "error": "<code>", "message": "..." }`:

| Status | Codes |
|---|---|
| 400 | `invalid_json`, `text_required`, `text_too_short`, `period_invalid`, `period_too_long` |
| 403 | `origin_not_allowed` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 413 | `payload_too_large`, `text_too_long` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` (with `Retry-After`) |
| 502 | `ai_failed`, `ai_bad_output` |
| 503 | `quota_exhausted` (with `Retry-After`); `ai_busy`; `ai_not_configured`; `ai_unavailable` |
| 504 | `ai_timeout` |

## Shortlist

The model sees at most 100 items per scene, not the whole inventory, so a scene's cost stays flat as catalogs are added.

- **Ranking.** `rankText` in `src/scripts/props-search.js` scores the scene text with the page's own keyword scoring: the same tokenizer, stopwords, stemming, field weights (name 3, description 2, categories 1, AI tags 1), prefix matches and idf, and the same sum times the share of words matched. Scene text gives no decade boost, because screenplay ages such as "(40s)" are not periods. The Worker bundles `tags.json` for the tags field.
- **Period.** When the period names decades (for example "1960s" or "sixties"), items whose stated decades are all different are left out. Items with no stated era stay. A period without decades, such as "WWII", leaves the list as it is.
- **Selection.** Each scene word that matches any item, and each pair of adjacent scene words (stopwords skipped) that match the same item, first keeps its best-ranked item. The number per word or pair is `termQuota` in `src/scene.js`, 1 today. Words and pairs with fewer matches go first; the remaining places fill by score.
  - So a prop named by one rare word, such as "stethoscope", keeps its place against items that match several common words, and a pair keeps "red chair" or "rotary phone" in the list.
  - A character's name can bring in an item with a pet name the same way, for one place.
  - For a long scene on a large inventory, the words and pairs can take every place, leaving none to fill by score.
- **Order and format.** The selected items are listed grouped by catalog section, in catalog order, in the same `key | name | era` lines as before.
- **Validation.** Returned keys are checked against the list actually sent.
- **Deterministic.** The list is a pure function of `inventory.json`, `tags.json`, the scene text and the period. `node scripts/shortlist.mjs --scene office [--period 1960s]` prints the list, the request size and its reservation; `node scripts/shortlist.mjs --recall` prints, for each fixture scene, how many required props keep an acceptable item in the list at each list size, and each acceptable item's rank in the plain ranking and whether it is listed. Neither calls the model.
- **CPU.** Ranking a 4,000-character scene and selecting its list takes about 1–2 ms on a laptop (1.3 ms at 571 items, 1.7 ms at 1,239), under the Free plan's 10 ms per request. The index is built once when the Worker starts.

## Cost guard

One SQLite-backed Durable Object, `AiBudget`, controls every AI call. The defaults are vars in `wrangler.jsonc`:

| Var | Default | What it limits |
|---|---|---|
| `DAILY_NEURON_BUDGET` | `5000` | Workers AI Neurons per UTC day. That is half of the account's free daily 10,000. |
| `AI_PER_CLIENT_PER_MINUTE` | `3` | requests per client address per minute |
| `AI_PER_MINUTE_LIMIT` | `20` | requests per minute for everyone |
| `AI_TIMEOUT_MS` | `30000` | how long to wait for the model; long scenes can take about 20 s |

- **Pre-charge.** Before each call, the Worker reserves the worst case: input tokens are bounded by the UTF-8 byte length of everything sent plus 256, and output by `max_completion_tokens` (1,700). Real usage can't exceed the reservation. With gemma-4-26b-a4b-it and the shortlist, the four original fixture scenes reserve about 124–158 Neurons at 1,010 items (205–225 when the whole inventory was sent).
- **Settling.** After a successful answer whose usage is well formed, the Worker sends the object one settle request, and the object lowers the day's spend from the reservation to the actual cost: prompt tokens plus completion tokens (plus reasoning tokens, if reported) at the model's rates. It never lowers spend by more than the reservation or below zero, and it refunds only against the UTC day the reservation was charged to. Before the shortlist, a typical scene cost about 70–90 Neurons after settling, roughly 55–70 scenes a day; `scripts/eval-models.mjs` reports the current figures.
- **Refunds only after success.** The charge is refunded down to actual usage only after a successful answer; never on failures (`ai_failed`, `ai_timeout`, `ai_busy`, `ai_bad_output`, `quota_exhausted`, `ai_not_configured`), and not when usage is missing or malformed. If the settle request fails or doesn't answer within 3 s, the worst-case charge stands and the answer is still returned. A Workers AI outage during heavy use can therefore use up the day's budget with nothing to show for it. When the budget is gone, scene matching shows "Today's AI matching budget is used up" until midnight UTC, and keyword search keeps working.
- **Midnight and minute boundaries.** Requests can reach the object slightly out of order. One stamped just before midnight (or before a new minute) that arrives after the new day (or minute) has begun is counted in the newer one, so it can't reset the new day's spend or the minute counters.
- **What is stored.** Durable storage holds one record, `{ day, spent }`. The per-client and per-minute counters live only in memory. They count the current minute and are reset by the first request of the next minute, so the last minute's client addresses stay in memory until then, or until Cloudflare evicts the object. Client addresses are never written to storage, logged or returned.
- **Fails closed.** A missing or malformed var, an unknown model, or a guard that errors or doesn't answer within 3 s turns the AI off (`ai_not_configured` or `ai_unavailable`). It never runs unguarded.

## Privacy

- Scene text goes only to Workers AI.
- The Worker has no `console` output, Workers Logs are off (`observability.enabled: false`), and there's no AI Gateway, analytics, KV or D1.
- Responses never echo the scene text.

## Tests

`npm test` (here, or the root `npm test`, which includes these files) runs the suite with plain Node and mocks. It needs no install, no network and no Cloudflare account.

## Model evaluation

`scripts/eval-models.mjs` sends the scenes in `test/fixtures/scenes/` to a running Worker and scores the answers against each scene's expected props: props found, wrong matches, invented keys, props the catalog lacks, truncation, latency, cost, the shortlist's size, and how many optional props came back with matches. Capacity is computed against `DAILY_NEURON_BUDGET` in `wrangler.jsonc`, leaving room for one reservation. It calls the real model, so it spends Neurons:

```sh
npx wrangler dev --port 8788 --var AI_PER_CLIENT_PER_MINUTE:100
node scripts/eval-models.mjs --url http://localhost:8788
```

`wrangler dev` uses the real AI binding, which bills the account, but a local copy of the budget object.

The output ends with the deploy gate, which must pass before a redeploy that changes the inventory or the tags:
- On the four original scenes (diner, hospital, office, police): every counted required prop is found, with 0 wrong keys, 0 invalid keys and no truncated output.
- Every scene has at most 1 misfiled key (see How an answer is scored, below).
- At least 3 of the 4 props those scenes name that the catalogs lack are reported as "no match": the hospital's IV pole and heart monitor, and the police scene's squad car and crime scene tape. The target is 4 of 4; the floor allows one miss because the model varies from run to run. The diner's absent props aren't counted, since that scene names more props than the lists hold.
  - The office scene no longer lists a water cooler or a fax machine. The inventory now holds both, but from the 1980s and 1990s, and the scene is set in 1962, so the gate neither rewards nor penalizes what the model does with them.
- Every other scene (today the morgue) meets the S1 floor: 70% of required props found, at most 1 wrong and 1 invalid key, and no truncation.

When new items match a scene's required prop, add their keys to that prop's `acceptableKeys` before the run, so that a correct pick doesn't count as a wrong key.

How an answer is scored (`scripts/rubric.mjs`). A suggested prop "names" a fixture prop when it contains all of that prop's words; one shared word alone never matches.
- **Absent prop named.** Every key is wrong: the catalog lacks that prop, so any item for it is a force-match. This holds even when the suggestion also names a required prop.
- **One required prop named.** Its acceptable keys count as found. Every other key is wrong.
- **Two or more required props named,** a merge such as "chef's coat and checkered pants".
  - Keys acceptable for any of them count as found.
  - A key acceptable only for another required prop of the scene is misfiled, listed with its item name. Misfiling doesn't make that prop found.
  - Any other key is wrong.
- **No prop named.** It is judged against the required prop whose acceptable keys it returned most of; every other key is wrong.
- **Extras.** A required prop the fixture doesn't know, such as a desk or a door in an office scene, is listed as an extra with its item names and never counted wrong. Check by hand that each extra's items are that kind of object.

The gate allows at most 1 misfiled key per scene.

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

The site uses the Worker only after `src/data/props/config.json` has `"apiUrl": "<URL>"` and that change is merged. Deploy the Worker again whenever `src/data/props/inventory.json` or `src/data/props/tags.json` changes, because the Worker bundles both.

Check the account's Workers plan (Free or Paid) in the Cloudflare dashboard. The guard doesn't depend on it, but only the Free plan hard-stops Workers AI at 10,000 Neurons a day.
