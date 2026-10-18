import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';
import { attribute, visibleText } from './html-text.mjs';
import { titleEra } from './retro-on-8th.mjs';

// The collection page's headings, each with what its tiles are: kept (a physical object, or a set of one kind of object,
// rented as such), a service (an attendant, a performer or a photographer, or photos, recordings or film the vendor
// produces) or a package (different items, or items and a service, rented together). The lead's rulings, 2026-10-18.
// A heading not listed here stops the import, so a new or renamed section is reviewed first.
export const SECTIONS = new Map([
  ['Our Rental Collection', 'title'],
  ['Audio Guestbooks', 'kept'],
  ['Audio Guestbook Displays', 'kept'],
  ['Video Guestbooks', 'service'],
  ['Digital Film Cameras', 'kept'],
  ['Photo Booths', 'service'],
  ['Vintage China', 'kept'],
  ['Wedding Card Boxes', 'kept'],
  ['Interactive Displays', 'kept'],
  ['Seating Charts', 'kept'],
  ['Exquisite Displays', 'kept'],
  ['Pittsburgh Wedding Cookie Table Displays & Bridges', 'kept'],
  ['Speciality Packages', 'package'],
]);
// Tiles in a kept section that the photo review found to be services (the lead's rulings, 2026-10-18). The Greenery
// wall's photo shows a hidden server's hand passing a glass through it, and the white wall is the same product, with a
// serving hatch and a doorbell for the hidden server, as "Living" says.
export const SERVICE_TILES = new Set(['Living Champagne Wall', 'Greenery Living Champagne Wall']);
// A rich text outside the tiles is a section heading when it has at most HEADING_WORDS words, and a section's
// description when it has more than DESCRIPTION_WORDS (the page's headings have 2 to 7 words, its descriptions 51 or
// more). Anything between stops the import, so a renamed heading can't pass as a description and file its tiles under
// the section before it.
const HEADING_WORDS = 8;
const DESCRIPTION_WORDS = 20;
const PHOTO_WIDTH = 320;
const PRICE_LINE = /^(?:\$\s*\d|inquire for pricing)/i;
const EXCLUSIONS = ['service', 'package'];

const divsOf = (html) => [...html.matchAll(/<div\b[^>]*>/gi)];
const classesOf = (tag) => (attribute(tag, 'class') ?? '').split(/\s+/).filter(Boolean);
const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

// The smallest published variant at least PHOTO_WIDTH wide, by the width in its fill transform, or else the widest.
// srcSet entries are split at a comma followed by a space, since the URLs themselves hold commas.
function photoOf(image, pageUrl) {
  const variants = (attribute(image, 'srcSet') ?? '').split(/,\s+/).map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean)
    .map((url) => ({ url: new URL(url, pageUrl), width: Number(url.match(/\/fill\/w_(\d+),/)?.[1]) }))
    .filter((variant) => Number.isFinite(variant.width));
  const source = attribute(image, 'src');
  if (!variants.length) return source ? { url: new URL(source, pageUrl), width: null } : null;
  const wide = variants.filter((variant) => variant.width >= PHOTO_WIDTH).sort((a, b) => a.width - b.width);
  return wide[0] ?? variants.sort((a, b) => b.width - a.width)[0];
}

// The page's main content in order: headings (short rich texts outside the tiles) and tiles (repeater items, each with
// its image and its own rich texts). A tile's parts carry its item id ("comp-x__item-y"); a heading's id has none.
function partsOf(html, pageUrl) {
  const start = html.indexOf('<main');
  const end = html.indexOf('</main>', start);
  if (start < 0 || end < 0) throw new Error('The collection page has no <main> content; the page layout has changed.');
  const main = html.slice(start, end);
  const divs = divsOf(main);
  const parts = [];
  divs.forEach((match, index) => {
    const [tag] = match;
    const id = attribute(tag, 'id') ?? '';
    const classes = classesOf(tag);
    const inTile = id.includes('__item');
    const content = main.slice(match.index + tag.length, divs[index + 1]?.index ?? main.length);
    if (classes.includes('wixui-repeater__item')) parts.push({ kind: 'tile', id });
    else if (classes.includes('wixui-rich-text')) parts.push({ kind: 'text', inTile, text: visibleText(content) });
    else if (classes.includes('wixui-image') && inTile) {
      const image = main.slice(match.index).match(/<img\b[^>]*>/i)?.[0] ?? '';
      parts.push({ kind: 'image', photo: photoOf(image, pageUrl) });
    }
  });
  return parts;
}

export function parseCollection(html, { vendor, catalog }, { sections = SECTIONS, serviceTiles = SERVICE_TILES } = {}) {
  const flags = [];
  const tiles = [];
  const seen = [];
  let section = null;
  for (const part of partsOf(html, catalog.sourceUrl)) {
    if (part.kind === 'text' && !part.inTile) {
      const words = part.text ? part.text.split(' ').length : 0;
      if (!words || words > DESCRIPTION_WORDS) continue;
      if (words > HEADING_WORDS) throw new Error(`The collection page has a text of ${words} words outside the tiles, too long for a section heading and too short for a description, "${part.text}"; stopping before the inventory is written.`);
      if (!sections.has(part.text)) throw new Error(`The collection page has a section heading this import doesn't know, "${part.text}"; stopping before the inventory is written.`);
      section = part.text;
      if (sections.get(section) !== 'title') seen.push(section);
    } else if (part.kind === 'tile') {
      if (!section || sections.get(section) === 'title') throw new Error(`A tile (${part.id}) comes before the first section heading; the page layout has changed.`);
      tiles.push({ id: part.id, section, texts: [], photo: null });
    } else if (part.kind === 'text' && tiles.length) tiles.at(-1).texts.push(part.text);
    else if (part.kind === 'image' && tiles.length && !tiles.at(-1).photo) tiles.at(-1).photo = part.photo;
  }
  if (!tiles.length) throw new Error('The collection page holds no tiles; the page layout has changed.');
  const excluded = Object.fromEntries(EXCLUSIONS.map((reason) => [reason, 0]));
  const perSection = new Map(seen.map((name) => [name, { tiles: 0, kept: 0 }]));
  const widths = new Map();
  const groups = [];
  const untitled = new Map();
  for (const tile of tiles) {
    const name = tile.texts.find((text) => text && !PRICE_LINE.test(text)) ?? '';
    let decision = sections.get(tile.section);
    if (decision === 'kept' && (/\bwith attendant\b/i.test(name) || serviceTiles.has(name))) decision = 'service';
    const counts = perSection.get(tile.section) ?? { tiles: 0, kept: 0 };
    counts.tiles += 1;
    perSection.set(tile.section, counts);
    if (decision !== 'kept') {
      excluded[decision] += 1;
      continue;
    }
    counts.kept += 1;
    if (tile.photo?.url.search) throw new Error(`The photo of "${name}" has a URL with a query (${[...tile.photo.url.searchParams.keys()].join(', ')}); a URL with a query is never stored.`);
    if (tile.photo && tile.photo.url.hostname !== catalog.photoHost) flags.push(`"${name}"'s photo is not on ${catalog.photoHost}: ${tile.photo.url.origin}${tile.photo.url.pathname}`);
    tally(widths, tile.photo ? tile.photo.width ?? 'no width' : 'no photo');
    const same = name && groups.find((group) => group.section === tile.section && group.name === name);
    if (same) {
      same.photos.push(tile.photo);
      continue;
    }
    groups.push({ section: tile.section, name, photos: [tile.photo] });
  }
  const items = [];
  const images = new Map();
  for (const group of groups) {
    let { name } = group;
    let key = siteKey(vendor.keyPrefix, `${group.section}|${name}`);
    if (!name) {
      const number = (untitled.get(group.section) ?? 0) + 1;
      untitled.set(group.section, number);
      name = `${group.section} item ${number} (no title given)`;
      key = siteKey(vendor.keyPrefix, `${group.section}|#${group.photos[0]?.url.pathname.split('/')[2] ?? number}`);
      flags.push(`${key} has no name, named "${name}"`);
    }
    if (group.photos.length > 1) flags.push(`${key} "${name}": ${group.photos.length} tiles of that name in ${group.section}, one item`);
    const elsewhere = groups.find((other) => other !== group && other.name && other.name === group.name && other.section !== group.section);
    if (elsewhere) flags.push(`${key} "${name}" is also a tile in ${elsewhere.section}; kept in each`);
    const era = titleEra(name);
    items.push({ key, vendor: vendor.id, catalog: catalog.id, name, description: null, categories: [group.section], era, decades: eraDecades(era), url: catalog.sourceUrl });
    images.set(key, { urls: group.photos.filter(Boolean).map((photo) => photo.url.href) });
  }
  const counts = { tiles: tiles.length, items: items.length, excluded };
  const report = [
    `Tiles: ${tiles.length}; kept: ${tiles.length - excluded.service - excluded.package}; items: ${items.length} (tiles of the same name in a section are one item); left out: ${EXCLUSIONS.map((reason) => `${reason} ${excluded[reason]}`).join(', ')}`,
    ...[...perSection].map(([name, { tiles: all, kept }]) => `  ${name} (${sections.get(name)}): ${all} tiles, ${kept} kept`),
    `Photo width used: ${[...widths].map(([width, count]) => `${width} px ${count}`).join(', ') || 'none'}`,
    `Items with an era in their name: ${items.filter((item) => item.era).length}`,
    ...(flags.length ? ['Flags:', ...flags.map((flag) => `  ${flag}`)] : ['Flags: none']),
    'Items (key · name · section · photos):',
    ...items.map((item) => `  ${item.key} · ${item.name} · ${item.categories[0]} · ${images.get(item.key).urls.length}`),
  ];
  return { items, images, counts, report };
}
