import { createHash } from 'node:crypto';
import inventory from '../data/props/inventory.json' with { type: 'json' };
import tagsData from '../data/props/tags.json' with { type: 'json' };
import vendorsData from '../data/props/vendors.json' with { type: 'json' };
import { readDemoManifest } from '../../scripts/props/demo-links.mjs';
import { cardsFile } from './props-cards.js';

// The one call that writes /props/cards.json: the endpoint serves this text, and the page hashes the same text for the
// file's ?v=, so a page never meets another build's data. In the local demo (PROPS_DEMO=1) the cards carry their
// thumbnails and local PDF links; a production build never sets it.
export function cardsText(env = process.env, read = readDemoManifest) {
  return cardsFile({ items: inventory.items, vendors: vendorsData.vendors, tags: tagsData.tags, demo: env.PROPS_DEMO === '1' ? read() : null });
}

export function cardsVersion(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}
