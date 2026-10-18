import inventory from '../../src/data/props/inventory.json' with { type: 'json' };
import tagsFile from '../../src/data/props/tags.json' with { type: 'json' };
import { buildIndex, parseDecades, rankText } from '../../src/scripts/props-search.js';
import { LIMITS, buildRequest } from './scene.js';

export const inventoryKeys = new Set(inventory.items.map((item) => item.key));

export function listing(items) {
  const sections = new Map();
  for (const item of items) {
    const section = item.categories[0] ?? 'OTHER';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push([item.key, item.name, item.era].filter(Boolean).join(' | '));
  }
  return [...sections].map(([section, lines]) => `## ${section}\n${lines.join('\n')}`).join('\n');
}

export function searchDocs(items, tags) {
  return items.map((item, order) => ({
    key: item.key,
    name: item.name,
    description: [item.name, item.era].filter(Boolean).join(' '),
    categories: item.categories,
    tags: tags[item.key] ?? [],
    decades: item.decades,
    vendor: item.vendor,
    order,
    item,
  }));
}

const index = buildIndex(searchDocs(inventory.items, tagsFile.tags));

export function ranked(text, period = '') {
  const periodDecades = parseDecades(period);
  const fits = (doc) => !periodDecades.size || !doc.decades.length || doc.decades.some((decade) => periodDecades.has(decade));
  return rankText(index, text).filter(fits);
}

export function shortlist(text, period = '') {
  return ranked(text, period).slice(0, LIMITS.shortlistSize).map((doc) => doc.item);
}

export function prepareScene(text, period = '') {
  const docs = ranked(text, period).slice(0, LIMITS.shortlistSize).sort((a, b) => a.order - b.order);
  const listingText = listing(docs.map((doc) => doc.item));
  return { request: buildRequest(listingText, text, period), listingText, shortlistKeys: new Set(docs.map((doc) => doc.key)) };
}
