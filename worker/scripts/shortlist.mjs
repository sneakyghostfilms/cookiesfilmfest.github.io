#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import inventory from '../../src/data/props/inventory.json' with { type: 'json' };
import { prepareScene, ranked } from '../src/inventory.js';
import { LIMITS, estimateNeurons } from '../src/scene.js';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(WORKER, 'test/fixtures/scenes');
const SIZES = [25, 50, 75, 100, 125, 150, 200, 300];
const { values } = parseArgs({ options: { scene: { type: 'string' }, period: { type: 'string', default: '' }, recall: { type: 'boolean', default: false } } });
const files = (await readdir(FIXTURES)).filter((file) => file.endsWith('.json')).sort();
const fixtures = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(FIXTURES, file), 'utf8'))));
const { vars } = JSON.parse(await readFile(join(WORKER, 'wrangler.jsonc'), 'utf8'));
const names = new Map(inventory.items.map((item) => [item.key, item.name]));

if (values.scene) {
  const fixture = fixtures.find((entry) => entry.id === values.scene);
  if (!fixture) throw new Error(`No fixture "${values.scene}"; try ${fixtures.map((entry) => entry.id).join(', ')}.`);
  const { request, listingText, shortlistKeys } = prepareScene(fixture.text, values.period);
  console.log(listingText);
  console.log(`\n${shortlistKeys.size} items (shortlist size ${LIMITS.shortlistSize}); request messages ${new TextEncoder().encode(JSON.stringify(request.messages)).length} bytes; reserves ${estimateNeurons(vars.AI_MODEL, request).toFixed(1)} Neurons with ${vars.AI_MODEL}`);
} else if (values.recall) {
  console.log(`| Fixture | ${SIZES.map((size) => `N=${size}`).join(' | ')} |\n|---|${SIZES.map(() => '---').join('|')}|`);
  const details = [];
  for (const fixture of fixtures) {
    const rank = new Map(ranked(fixture.text).map((doc, index) => [doc.key, index + 1]));
    const reach = (size) => fixture.required.filter((prop) => prop.acceptableKeys.some((key) => (rank.get(key) ?? Infinity) <= size)).length;
    console.log(`| ${fixture.id} (${fixture.required.length}) | ${SIZES.map((size) => reach(size)).join(' | ')} |`);
    details.push(`\n${fixture.id}:`);
    for (const prop of fixture.required) {
      const keys = prop.acceptableKeys.map((key) => `${key} "${names.get(key) ?? 'NOT IN INVENTORY'}" rank ${rank.get(key) ?? '-'}`);
      details.push(`  ${prop.prop}: ${keys.join('; ')}`);
    }
    if (fixture.absent.length) details.push(`  absent: ${fixture.absent.join(', ')}`);
  }
  console.log(details.join('\n'));
} else {
  console.error('Usage: node scripts/shortlist.mjs --scene <fixture id> [--period 1960s]  or  node scripts/shortlist.mjs --recall');
  process.exit(1);
}
