#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CACHE_ROOT } from './import-site.mjs';
import { REDACTED, isTrackingParameter } from './tracking.mjs';

// Lists the query-parameter names in a vendor's cached pages, with counts, and any tracking name that still holds a
// value. It prints names only, never a value. It reads URLs only: those in attribute values (href, src, srcset, action,
// content) and those in JSON strings, so a name-like token in script code is never listed.
const ATTRIBUTE = /\s(href|src|srcset|action|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const JSON_STRING = /"((?:[^"\\]|\\.)*)"/g;
const URL_WITH_QUERY = /^(?:https?:\/\/|\/)\S*\?/i;
const BINARY = /^\s*(?:(?:image|audio|video|font)\/|application\/(?:pdf|octet-stream|zip|gzip))/i;
const decodeAmpersands = (text) => text.replace(/&(?:amp|#0*38|#x0*26);/gi, '&');

function urlsIn(text) {
  const urls = [];
  const rest = text.replace(ATTRIBUTE, (whole, name, double, single) => {
    const value = decodeAmpersands(double ?? single);
    urls.push(...(name.toLowerCase() === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/)[0]) : [value]));
    return ' ';
  });
  for (const [, raw] of rest.matchAll(JSON_STRING)) {
    try {
      urls.push(JSON.parse(`"${raw}"`));
    } catch {
      // Not a JSON string, such as a quoted phrase with a stray backslash in prose.
    }
  }
  return urls.filter((url) => URL_WITH_QUERY.test(url));
}

// Each parameter of a URL, and one level of the URLs nested in its values, as share links carry them.
function parameters(url, nested = true) {
  let parsed;
  try {
    parsed = new URL(url, 'https://cache-scan.invalid/');
  } catch {
    return [];
  }
  return [...parsed.searchParams].flatMap(([name, value]) => [[name, value], ...(nested && URL_WITH_QUERY.test(value) ? parameters(value, false) : [])]);
}

export function scanBody(text) {
  const counts = new Map();
  const holding = new Set();
  for (const url of urlsIn(text)) {
    for (const [name, value] of parameters(url)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (isTrackingParameter(name) && value && value !== REDACTED) holding.add(name);
    }
  }
  return { counts, holding };
}

async function bodiesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return bodiesUnder(path);
    return entry.name.endsWith('.body') ? [path] : [];
  }));
  return nested.flat().sort();
}

export async function scanVendor(directory) {
  const result = { bodies: 0, skipped: 0, counts: new Map(), holding: new Set() };
  for (const path of await bodiesUnder(directory)) {
    const metaPath = path.replace(/\.body$/, '.meta.json');
    const meta = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, 'utf8')) : {};
    if (BINARY.test(meta.contentType ?? '')) {
      result.skipped += 1;
      continue;
    }
    result.bodies += 1;
    const { counts, holding } = scanBody((await readFile(path)).toString('latin1'));
    for (const [name, count] of counts) result.counts.set(name, (result.counts.get(name) ?? 0) + count);
    for (const name of holding) result.holding.add(name);
  }
  return result;
}

export function formatScan(vendorId, { bodies, skipped, counts, holding }) {
  const names = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => `${name} ${count}`);
  return [
    `${vendorId}: ${bodies} cached text bodies scanned${skipped ? `, ${skipped} binary skipped` : ''}`,
    `  query-parameter names: ${names.join(', ') || 'none'}`,
    `  tracking names still holding a value: ${[...holding].sort().join(', ') || 'none'}`,
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({ options: { vendor: { type: 'string' }, cache: { type: 'string', default: CACHE_ROOT } } });
  if (!values.vendor) throw new Error('Usage: npm run props:cache-scan -- --vendor <id> [--cache <dir>]');
  const directory = join(values.cache, values.vendor);
  if (!existsSync(directory)) throw new Error(`No cache for ${values.vendor} under ${values.cache}`);
  console.log(formatScan(values.vendor, await scanVendor(directory)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
