#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareScene } from '../src/inventory.js';
import { LIMITS, MODELS, actualNeurons, estimateNeurons } from '../src/scene.js';
import { SLOTS, score } from './rubric.mjs';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(WORKER, 'test/fixtures/scenes');
const DAILY_BUDGET = Number(JSON.parse(await readFile(join(WORKER, 'wrangler.jsonc'), 'utf8')).vars.DAILY_NEURON_BUDGET);
const FLOOR = { requiredShare: 0.7, invalidKeysPerScene: 1, wrongKeysPerScene: 1, scenesPerDay: 50 };
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    scene: { type: 'string' },
    origin: { type: 'string', default: 'http://localhost:4321' },
  },
});
if (!values.url) {
  console.error('Usage: node scripts/eval-models.mjs --url <worker base URL> [--scene office] [--origin http://localhost:4321]');
  process.exit(1);
}

const files = (await readdir(FIXTURES)).filter((file) => file.endsWith('.json')).sort();
const fixtures = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(FIXTURES, file), 'utf8'))));
const selected = values.scene ? fixtures.filter((fixture) => fixture.id === values.scene) : fixtures;
const rows = [];
for (const fixture of selected) {
  const started = Date.now();
  const response = await fetch(`${values.url.replace(/\/+$/, '')}/v1/scene`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: values.origin },
    body: JSON.stringify({ text: fixture.text }),
  });
  const seconds = (Date.now() - started) / 1000;
  const body = await response.json().catch(() => ({}));
  if (!body.ok) {
    rows.push({ fixture, seconds, error: `${response.status} ${body.error ?? 'no JSON'}` });
    continue;
  }
  const known = Boolean(MODELS[body.model]);
  const prepared = prepareScene(fixture.text);
  rows.push({
    fixture,
    seconds,
    body,
    shortlist: { items: prepared.shortlistKeys.size, bytes: new TextEncoder().encode(JSON.stringify(prepared.request.messages)).length },
    reserved: known ? estimateNeurons(body.model, prepared.request) : null,
    truncated: Boolean(body.usage && body.usage.outputTokens >= LIMITS.maxOutputTokens),
    result: score(fixture, body),
    used: known && body.usage ? actualNeurons(body.model, { prompt_tokens: body.usage.inputTokens, completion_tokens: body.usage.outputTokens }) : null,
  });
}

const lines = [];
const listed = (prop, mark) => `${mark}:${prop.prop} [${prop.keys.join(', ')}]`;
for (const row of rows) {
  lines.push(`\n### ${row.fixture.id} (${row.fixture.text.length} characters, ${row.seconds.toFixed(1)} s)`);
  if (row.error) {
    lines.push(`- request failed: ${row.error}`);
    continue;
  }
  const { body, result, used } = row;
  lines.push(`- model ${body.model}; required props found ${result.found}/${result.required.length} (${result.required.filter((entry) => entry.asRequired).length} listed as required); invalid keys ${body.ignoredSuggestions}; wrong keys ${result.wrongKeys.length ? result.wrongKeys.join('; ') : 'none'}`);
  lines.push(`- usage ${body.usage ? `${body.usage.inputTokens} in / ${body.usage.outputTokens} out${row.truncated ? ' (TRUNCATED)' : ''}` : 'not reported'}; reserved ${row.reserved === null ? 'unknown' : row.reserved.toFixed(1)} Neurons; charged after settling ${body.chargedNeurons}; used ${used === null ? 'unknown' : used.toFixed(1)}`);
  lines.push(`- shortlist ${row.shortlist.items} items, request messages ${row.shortlist.bytes} bytes; optional props with keys ${body.optional.filter((prop) => prop.keys.length).length}`);
  if (result.dense) lines.push(`- this scene names more props than the lists hold (${SLOTS}), so at most ${LIMITS.maxRequiredProps} found props count and absent props are not scored`);
  for (const entry of result.required) lines.push(`  - ${entry.found ? '✓' : '✗'} ${entry.prop}`);
  if (result.setDressing.length) lines.push(`  - set dressing, not scored: ${result.setDressing.join(' | ')}`);
  for (const entry of result.absent) lines.push(`  - absent "${entry.name}": ${entry.outcome}`);
  lines.push(`  - model's props: ${[...body.required.map((prop) => listed(prop, 'R')), ...body.optional.map((prop) => listed(prop, 'O'))].join(' | ')}`);
}

const scored = rows.filter((row) => !row.error);
const sum = (pick, list = scored) => list.reduce((total, row) => total + pick(row), 0);
const counted = sum((row) => row.result.counted);
const countable = sum((row) => row.result.countable);
const fitting = scored.filter((row) => !row.result.dense);
const dense = scored.filter((row) => row.result.dense);
const lowestCapacity = Math.min(...scored.map((row) => Math.floor((DAILY_BUDGET - (row.reserved ?? 0)) / row.body.chargedNeurons) + 1));
const checks = [
  ['every request answered', rows.length === scored.length, `${scored.length}/${rows.length}`],
  [`required props found ≥ ${FLOOR.requiredShare * 100}%`, countable > 0 && counted / countable >= FLOOR.requiredShare, `${counted}/${countable} (${countable ? Math.round((100 * counted) / countable) : 0}%)`],
  ['no truncated output', scored.every((row) => !row.truncated), scored.filter((row) => row.truncated).map((row) => row.fixture.id).join(', ') || 'none'],
  [`at most ${FLOOR.invalidKeysPerScene} invalid key per scene`, scored.every((row) => row.body.ignoredSuggestions <= FLOOR.invalidKeysPerScene), scored.map((row) => row.body.ignoredSuggestions).join(', ')],
  [`at most ${FLOOR.wrongKeysPerScene} wrong key per scene`, scored.every((row) => row.result.wrongKeys.length <= FLOOR.wrongKeysPerScene), scored.map((row) => row.result.wrongKeys.length).join(', ')],
  ['every absent prop reported as no match', sum((row) => row.result.honest, fitting) === sum((row) => row.result.absent.length, fitting), `${sum((row) => row.result.honest, fitting)}/${sum((row) => row.result.absent.length, fitting)}`],
  [`scenes too long for the lists return at least ${LIMITS.maxRequiredProps} matched props`, dense.every((row) => row.result.withKeys >= LIMITS.maxRequiredProps), dense.map((row) => `${row.fixture.id} ${row.result.withKeys}`).join(', ') || 'none'],
  [`capacity ≥ ${FLOOR.scenesPerDay} scenes a day at ${DAILY_BUDGET} Neurons`, lowestCapacity >= FLOOR.scenesPerDay, `${lowestCapacity} for the costliest scene`],
];
lines.push('\n| Scene | Shortlist | Required found | Listed as required | Wrong keys | Absent reported as no match | Invalid keys | Optional with keys | Output tokens | Latency | Reserved | Charged after settling |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const row of rows) {
  if (row.error) {
    lines.push(`| ${row.fixture.id} | | request failed: ${row.error} | | | | | | | ${row.seconds.toFixed(1)} s | | |`);
    continue;
  }
  const { body, result } = row;
  const absentCell = `${result.honest}/${result.absent.length}${result.dense ? ' (not scored)' : ''}`;
  lines.push(`| ${row.fixture.id} | ${row.shortlist.items} items, ${row.shortlist.bytes} B | ${result.found}/${result.required.length}${result.dense ? ` (counts as ${result.counted}/${result.countable})` : ''} | ${result.required.filter((entry) => entry.asRequired).length} | ${result.wrongKeys.length} | ${absentCell} | ${body.ignoredSuggestions} | ${body.optional.filter((prop) => prop.keys.length).length} | ${body.usage?.outputTokens ?? '?'}${row.truncated ? ' (truncated)' : ''} | ${row.seconds.toFixed(1)} s | ${row.reserved === null ? '?' : row.reserved.toFixed(1)} | ${body.chargedNeurons} |`);
}
lines.push('\nQuality floor:');
for (const [label, passed, detail] of checks) lines.push(`- ${passed ? 'PASS' : 'FAIL'} ${label}: ${detail}`);
lines.push(`\nNeurons used by these ${scored.length} calls: ${sum((row) => row.used ?? 0).toFixed(1)}`);
console.log(lines.join('\n'));
