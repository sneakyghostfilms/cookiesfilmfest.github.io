#!/usr/bin/env node
// Measures the Worker's shortlist offline, with and without the AI tags, on the fixture scenes and the long scene:
// required props with an acceptable item in the 100-item list, absent-prop exposure, the request each list makes and
// its reservation, items per kind, and, with --cpu <runs>, the time to rank and select. Calls no model.
// See README.md, "Model evaluation".
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import inventory from '../../src/data/props/inventory.json' with { type: 'json' };
import kindsFile from '../../src/data/props/kinds.json' with { type: 'json' };
import tagsFile from '../../src/data/props/tags.json' with { type: 'json' };
import { KINDS, kindOf } from '../../src/scripts/props-kinds.js';
import { buildIndex, rankText, sceneTermMatches, tokenize } from '../../src/scripts/props-search.js';
import { diversify, listing, prepareScene, searchDocs } from '../src/inventory.js';
import { LIMITS, buildRequest, estimateNeurons } from '../src/scene.js';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEMMA = '@cf/google/gemma-4-26b-a4b-it';

// The Worker's own ranking and selection over an index built with or without the tags field.
export function lexicalList(index, text) {
  return diversify(rankText(index, text), sceneTermMatches(index, text), { size: LIMITS.shortlistSize, quota: LIMITS.termQuota }).map((doc) => doc.key);
}

// Absent-prop exposure: listed items whose name or tags hold the absent prop's last word.
export function exposure(listKeys, absentProps, wordsOf) {
  return absentProps.map((prop) => {
    const word = tokenize(prop).at(-1);
    return { prop, word, keys: listKeys.filter((key) => wordsOf(key).has(word)) };
  });
}

// The long scene's "<fixture>:<prop>" references, resolved against the current fixtures.
export function resolveLongScene(long, fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const find = (reference, list) => {
    const [id, ...rest] = reference.split(':');
    const prop = rest.join(':');
    const matches = list(byId.get(id) ?? { required: [], absent: [] }).filter((entry) => (entry.prop ?? entry) === prop);
    if (matches.length !== 1) throw new Error(`long scene: "${reference}" matches ${matches.length} fixture props`);
    return matches[0];
  };
  return {
    id: long.id,
    text: long.text,
    required: long.required.map((reference) => ({ prop: reference, acceptableKeys: find(reference, (fixture) => fixture.required).acceptableKeys })),
    absent: long.absent.map((reference) => find(reference, (fixture) => fixture.absent)),
  };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const bytes = (text) => new TextEncoder().encode(text).length;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

async function main() {
  const { values } = parseArgs({ options: { cpu: { type: 'string', default: '0' } } });
  const items = inventory.items;
  const tags = tagsFile.tags;
  const byKey = new Map(items.map((item) => [item.key, item]));
  const position = new Map(items.map((item, at) => [item.key, at]));
  const catalogOrder = (keys) => [...keys].sort((a, b) => position.get(a) - position.get(b));
  const directory = join(WORKER, 'test/fixtures/scenes');
  const fixtures = await Promise.all((await readdir(directory)).filter((file) => file.endsWith('.json')).sort().map(async (file) => JSON.parse(await readFile(join(directory, file), 'utf8'))));
  const long = resolveLongScene(JSON.parse(await readFile(join(WORKER, 'test/fixtures/long-scene.json'), 'utf8')), fixtures);
  const scenes = [...fixtures, long];
  const words = new Map(items.map((item) => [item.key, new Set(tokenize(`${item.name} ${(tags[item.key] ?? []).join(' ')}`))]));
  const lines = [];

  const indexes = { a: buildIndex(searchDocs(items, {}, kindsFile)), b: buildIndex(searchDocs(items, tags, kindsFile)) };
  const arms = new Map([['a', '(a) without tags'], ['b', '(b) with tags (the Worker)']]);
  const lists = new Map([...arms.keys()].map((arm) => [arm, new Map(scenes.map((scene) => [scene.id, lexicalList(indexes[arm], scene.text)]))]));
  for (const scene of scenes) {
    if (JSON.stringify(catalogOrder(lists.get('b').get(scene.id))) !== JSON.stringify(catalogOrder(prepareScene(scene.text).shortlistKeys))) throw new Error(`arm (b) does not reproduce the Worker's list for ${scene.id}`);
  }
  lines.push(`Arm (b) reproduces prepareScene's list for every scene. Its requests, sha256 of JSON.stringify(prepareScene(text).request), first 12 hex: ${scenes.map((scene) => `${scene.id} ${createHash('sha256').update(JSON.stringify(prepareScene(scene.text).request)).digest('hex').slice(0, 12)}`).join(', ')}.`);

  const listed = (arm, scene) => lists.get(arm).get(scene.id);
  const reach = (arm, scene) => scene.required.filter((prop) => prop.acceptableKeys.some((key) => listed(arm, scene).includes(key))).length;
  lines.push('\n### Required props with an acceptable item in the 100-item list\n', table(
    ['Arm', ...fixtures.map((fixture) => `${fixture.id} (${fixture.required.length})`), `fixtures (${fixtures.reduce((sum, fixture) => sum + fixture.required.length, 0)})`, `long scene (${long.required.length})`],
    [...arms].map(([arm, label]) => [label, ...fixtures.map((fixture) => reach(arm, fixture)), fixtures.reduce((sum, fixture) => sum + reach(arm, fixture), 0), reach(arm, long)]),
  ));
  for (const [arm, label] of arms) {
    lines.push(`- ${label} misses: ${scenes.map((scene) => `${scene.id}: ${scene.required.filter((prop) => !prop.acceptableKeys.some((key) => listed(arm, scene).includes(key))).map((prop) => prop.prop).join(', ') || 'none'}`).join('; ')}`);
  }

  lines.push('\n### Absent-prop exposure: listed items whose name or tags hold the absent prop\'s last word\n', table(
    ['Arm', ...scenes.flatMap((scene) => scene.absent.map((prop) => `${scene.id} "${tokenize(prop).at(-1)}"`))],
    [...arms].map(([arm, label]) => [label, ...scenes.flatMap((scene) => exposure(listed(arm, scene), scene.absent, (key) => words.get(key)).map((entry) => entry.keys.length))]),
  ));

  lines.push('\n### The request each list makes to Gemma: messages bytes / reservation (Neurons)\n', table(['Arm', ...scenes.map((scene) => scene.id)], [...arms].map(([arm, label]) => [label, ...scenes.map((scene) => {
    const request = buildRequest(listing(catalogOrder(listed(arm, scene)).map((key) => byKey.get(key))), scene.text);
    return `${bytes(JSON.stringify(request.messages)).toLocaleString('en-US')} / ${estimateNeurons(GEMMA, request).toFixed(1)}`;
  })])));

  lines.push(`\n### Items per kind in each list (${KINDS.map(({ label }) => label.toLowerCase()).join(' / ')})\n`, table(['Arm', ...scenes.map((scene) => scene.id)], [...arms].map(([arm, label]) => [label, ...scenes.map((scene) => KINDS.map(({ id }) => listed(arm, scene).filter((key) => kindOf(byKey.get(key), kindsFile) === id).length).join(' / '))])));

  // Ranking and selection time per scene, the arms interleaved per round, after 20 warm-up rounds; the index is
  // prebuilt, as the Worker builds it at startup.
  const rounds = Number(values.cpu);
  if (rounds > 0) {
    const timed = new Map([...arms.keys()].map((arm) => [arm, new Map(scenes.map((scene) => [scene.id, []]))]));
    const runs = scenes.flatMap((scene) => [...arms.keys()].map((arm) => ({ scene, arm })));
    for (let round = -20; round < rounds; round += 1) {
      for (const { scene, arm } of runs) {
        const started = process.hrtime.bigint();
        lexicalList(indexes[arm], scene.text);
        if (round >= 0) timed.get(arm).get(scene.id).push(Number(process.hrtime.bigint() - started) / 1e6);
      }
    }
    lines.push(`\n### Time to rank and select, ms (median of ${rounds} runs; Node ${process.version})\n`, table(['Arm', ...scenes.map((scene) => scene.id)], [...arms].map(([arm, label]) => [label, ...scenes.map((scene) => median(timed.get(arm).get(scene.id)).toFixed(2))])));
  }
  console.log(lines.join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
