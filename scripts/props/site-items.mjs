import { createHash } from 'node:crypto';
import { eraDecades } from './normalize.mjs';

const ITEM_FIELDS = new Set(['key', 'vendor', 'catalog', 'name', 'description', 'categories', 'era', 'decades', 'url']);
const PRICED_TYPES = new Set(['shopify-export']);

export function siteKey(prefix, input) {
  const digest = createHash('sha256').update(input, 'utf8').digest('hex');
  return `${prefix}-${(BigInt(`0x${digest.slice(0, 12)}`) % 36n ** 6n).toString(36).padStart(6, '0')}`;
}

function listingProblem(text) {
  if (typeof text !== 'string' || !text.trim()) return 'is empty';
  if (/[\u0000-\u001f\u007f]/.test(text)) return 'holds a control character or line break';
  if (text.includes(' | ')) return 'holds " | ", which would break a listing line';
  return null;
}

export function checkSiteItems(items, { vendor, catalog }) {
  const problems = [];
  const keys = new Set();
  const keyShape = new RegExp(`^${vendor.keyPrefix}-[0-9a-z]{6}$`);
  for (const item of items) {
    const label = item.key ?? JSON.stringify(item.name);
    if (!keyShape.test(item.key ?? '') || keys.has(item.key)) problems.push(`${label}: missing, malformed or duplicate key`);
    keys.add(item.key);
    const extra = Object.keys(item).filter((field) => !ITEM_FIELDS.has(field) && !(field === 'listedPrice' && PRICED_TYPES.has(catalog.type)));
    if (extra.length) problems.push(`${label}: unexpected fields ${extra.join(', ')}`);
    if (item.vendor !== vendor.id || item.catalog !== catalog.id) problems.push(`${label}: wrong vendor or catalog`);
    const nameProblem = listingProblem(item.name);
    if (nameProblem) problems.push(`${label}: name ${nameProblem}`);
    if (!Array.isArray(item.categories)) problems.push(`${label}: categories is not a list`);
    for (const category of item.categories ?? []) {
      const categoryProblem = listingProblem(category);
      if (categoryProblem) problems.push(`${label}: category ${categoryProblem}`);
    }
    if (item.era !== null && listingProblem(item.era)) problems.push(`${label}: era ${listingProblem(item.era)}`);
    if (JSON.stringify(item.decades) !== JSON.stringify(eraDecades(item.era))) problems.push(`${label}: decades not derived from era`);
    if (item.description !== null) problems.push(`${label}: website items store no description`);
    if (typeof item.url !== 'string' || !item.url.startsWith(catalog.siteUrl)) problems.push(`${label}: url is not under ${catalog.siteUrl}`);
    if ('listedPrice' in item && !/^\d+(\.\d+)?$/.test(item.listedPrice)) problems.push(`${label}: listedPrice is not a plain amount`);
  }
  return problems;
}
