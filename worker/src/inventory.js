import inventory from '../../src/data/props/inventory.json' with { type: 'json' };
import kindsFile from '../../src/data/props/kinds.json' with { type: 'json' };
import tagsFile from '../../src/data/props/tags.json' with { type: 'json' };
import { kindOf } from '../../src/scripts/props-kinds.js';
import { buildIndex, parseDecades, rankText, sceneTermMatches } from '../../src/scripts/props-search.js';
import { LIMITS, buildRequest } from './scene.js';

export const inventoryKeys = new Set(inventory.items.map((item) => item.key));
const catalogOrder = new Map(inventory.items.map((item, order) => [item.key, order]));

export function listing(items) {
  const sections = new Map();
  for (const item of items) {
    const section = item.categories[0] ?? 'OTHER';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push([item.key, item.name, item.era].filter(Boolean).join(' | '));
  }
  return [...sections].map(([section, lines]) => `## ${section}\n${lines.join('\n')}`).join('\n');
}

export function searchDocs(items, tags, kinds) {
  return items.map((item, order) => ({
    key: item.key,
    name: item.name,
    description: [item.name, item.era].filter(Boolean).join(' '),
    categories: item.categories,
    tags: tags[item.key] ?? [],
    decades: item.decades,
    vendor: item.vendor,
    kind: kindOf(item, kinds),
    order,
    item,
  }));
}

const index = buildIndex(searchDocs(inventory.items, tagsFile.tags, kindsFile));

export function ranked(text, period = '') {
  const periodDecades = parseDecades(period);
  const fits = (doc) => !periodDecades.size || !doc.decades.length || doc.decades.some((decade) => periodDecades.has(decade));
  return rankText(index, text).filter(fits);
}

export function diversify(order, terms, { size, quota }) {
  const rank = new Map(order.map((doc, position) => [doc.key, position]));
  // Event rentals take no word or pair slot, so bulk event stock can't crowd out the props a scene names. They still
  // compete by rank in the fill.
  const eventRentals = new Set(order.filter((doc) => doc.kind === 'event-rental').map((doc) => doc.key));
  const queue = terms
    .map(({ keys }, first) => ({ first, keys: keys.filter((key) => rank.has(key) && !eventRentals.has(key)).sort((a, b) => rank.get(a) - rank.get(b)) }))
    .filter(({ keys }) => keys.length)
    .sort((a, b) => a.keys.length - b.keys.length || a.first - b.first);
  const picked = new Set();
  for (let round = 0; round < quota; round += 1) {
    for (const { keys } of queue) if (picked.size < size && keys[round]) picked.add(keys[round]);
  }
  for (const doc of order) {
    if (picked.size >= size) break;
    picked.add(doc.key);
  }
  return order.filter((doc) => picked.has(doc.key));
}

export function shortlist(text, period = '', size = LIMITS.shortlistSize) {
  return diversify(ranked(text, period), sceneTermMatches(index, text), { size, quota: LIMITS.termQuota }).map((doc) => doc.item);
}

export function prepareScene(text, period = '') {
  const items = shortlist(text, period).sort((a, b) => catalogOrder.get(a.key) - catalogOrder.get(b.key));
  const listingText = listing(items);
  return { request: buildRequest(listingText, text, period), listingText, shortlistKeys: new Set(items.map((item) => item.key)) };
}
