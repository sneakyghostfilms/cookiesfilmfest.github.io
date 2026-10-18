import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';
import { attribute, decodeEntities } from './html-text.mjs';
import { titleEra } from './retro-on-8th.mjs';

export const LISTING_PAGE_LIMIT = 40;
const PHOTO_WIDTH = 320;
const EXCLUSIONS = ['not in stock', 'building material', 'repeated'];
// How an item is sold (in the store, online, shipped), not what it is; "Ship" would also match scene words.
const FULFILLMENT = new Set(['in-store', 'online', 'ship']);

// Building materials are left out (lead's ruling, 2026-10-18): each category slug with the name the shop page gives it.
// A card is left out only when every category it has, fulfillment aside, is one of these.
export const BUILDING_MATERIAL_CATEGORIES = new Map([
  ['building-material-and-lumber', 'Building Materials and Lumber'],
  ['building-material', 'Building Material'],
  ['building-material-parts-and-accessories', 'Building Material/Parts and Accessories'],
  ['salvaged-lumber', 'Salvaged Lumber'],
  ['dimensional-lumber', 'Dimensional Lumber'],
  ['moulding', 'Moulding'],
  ['cj-made-planed-lumber', 'CJ Made Planed Lumber'],
  ['pipe', 'Pipe'],
  ['pvc-pipe', 'PVC Pipe'],
  ['plumbing-bath-parts-and-accessories', 'Plumbing/Bath Parts and Accessories'],
  ['other-plb', 'Other PLB'],
  ['paint', 'Paint'],
  ['amazon-paint', 'Amazon Paint'],
  ['roofing', 'Roofing'],
  ['roof-tile', 'Roof Tile'],
  ['tile-and-accessories', 'Tile'],
  ['flooring-and-accessories', 'Flooring and Accessories'],
  ['wood-flooring', 'Wood Flooring'],
  ['wood-tongue-and-groove-flooring', 'Wood Tongue and Groove Flooring'],
  ['flooring-parts-and-accessories', 'Flooring Parts and Accessories'],
  ['sheet-goods', 'Sheet Goods'],
  ['cement-board', 'Cement Board'],
  ['masonry-and-finished-stone', 'Masonry and Finished Stone'],
  ['other-mas', 'Other MAS'],
  ['formed-concrete', 'Formed Concrete'],
]);

const textOf = (html) => decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(([tag]) => tag);
const classesOf = (tag) => (attribute(tag, 'class') ?? '').split(/\s+/).filter(Boolean);

// The category widget ends a parent category's name with " -" ("Chair -"): its punctuation, not part of the name.
export const categoryName = (html) => textOf(html).replace(/\s+-$/, '');

function categorySlug(href, siteUrl) {
  if (!href) return null;
  const url = new URL(href, siteUrl);
  if (url.origin !== new URL(siteUrl).origin || !url.pathname.startsWith('/product-category/')) return null;
  return url.pathname.split('/').filter(Boolean).at(-1);
}

// Names come first from the page's product-categories widget, then the filter widget's titles (which add the store's
// source categories, such as Antique), then any other product-category link, such as the menu's.
export function categoryNames(html, siteUrl) {
  const names = new Map();
  const name = (slug, text) => {
    if (slug && !names.has(slug)) names.set(slug, categoryName(text));
  };
  const links = (segment) => [...segment.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(([, attributes, text]) => [categorySlug(attribute(`<a${attributes}>`, 'href'), siteUrl), text]);
  const start = html.indexOf('widget_product_categories');
  if (start >= 0) {
    const end = html.indexOf('<!-- //sidebar-widget -->', start);
    for (const [slug, text] of links(html.slice(start, end < 0 ? html.length : end))) name(slug, text);
  }
  for (const [, slug, text] of html.matchAll(/data-value="([^"]+)">\s*<div class="wcpf-item-inner[^"]*">\s*<button[^>]*>\s*<div class="wcpf-title-container">\s*<span class="wcpf-title">([^<]*)<\/span>/g)) name(slug, text);
  for (const [slug, text] of links(html)) name(slug, text);
  return names;
}

// The walk follows each page's own next link, and stops before any request when that link isn't the next page number
// or when the visible link and rel="next" disagree. No page URL is built, so no guessed URL can 404.
export function nextListingPage(html, sourceUrl, page) {
  const visible = tagsOf(html, 'a').filter((tag) => ['next', 'page-numbers'].every((name) => classesOf(tag).includes(name))).map((tag) => attribute(tag, 'href'));
  const rel = tagsOf(html, 'link').filter((tag) => attribute(tag, 'rel') === 'next').map((tag) => attribute(tag, 'href'));
  if (!visible.length && !rel.length) return null;
  if (visible.length !== 1 || rel.length !== 1 || visible[0] !== rel[0]) {
    throw new Error(`Page ${page}'s next links disagree (visible ${JSON.stringify(visible)}, rel="next" ${JSON.stringify(rel)}); stopping before any further request.`);
  }
  const expected = `${sourceUrl}page/${page + 1}/`;
  if (visible[0] !== expected) throw new Error(`Page ${page}'s next link is ${visible[0]}, not ${expected}; stopping before any further request.`);
  return expected;
}

function cardsOf(html) {
  const starts = [...html.matchAll(/<div\b[^>]*>/g)].filter(([tag]) => classesOf(tag).includes('type-product'));
  const pagination = html.indexOf('woocommerce-pagination');
  return starts.map((match, index) => {
    const end = starts[index + 1]?.index ?? (pagination > match.index ? pagination : html.length);
    return { classes: classesOf(match[0]), html: html.slice(match.index, end) };
  });
}

const plainAmount = (html) => {
  const amount = textOf(html).replace(/[$,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(amount) ? amount : null;
};

// A sale shows the old price in <del> and the current one in <ins>; a range shows two amounts and gets no price.
function priceOf(card) {
  const amounts = (html) => [...html.matchAll(/<span class="woocommerce-Price-amount amount">\s*<bdi>([\s\S]*?)<\/bdi>/g)].map(([, inner]) => inner);
  const sale = card.match(/<ins\b[^>]*>([\s\S]*?)<\/ins>/);
  const shown = amounts(sale ? sale[1] : card);
  if (shown.length > 1) return { kind: 'range' };
  const price = shown.length ? plainAmount(shown[0]) : null;
  return price ? { kind: sale ? 'sale' : 'price', price } : { kind: 'none' };
}

// The smallest published variant at least as wide as the demo's thumbnails, or else the widest there is.
function photoOf(card) {
  const image = tagsOf(card, 'img').find((tag) => attribute(tag, 'data-srcset') || attribute(tag, 'data-src'));
  if (!image) return { url: null, variant: 'no photo' };
  const variants = (attribute(image, 'data-srcset') ?? '').split(',').map((entry) => entry.trim().split(/\s+/)).filter(([url, width]) => url && /^\d+w$/.test(width ?? '')).map(([url, width]) => ({ url, width: Number.parseInt(width, 10) }));
  if (!variants.length) return { url: attribute(image, 'data-src'), variant: 'data-src only' };
  const wide = variants.filter((variant) => variant.width >= PHOTO_WIDTH).sort((a, b) => a.width - b.width);
  const chosen = wide[0] ?? variants.sort((a, b) => b.width - a.width)[0];
  return { url: chosen.url, variant: wide.length ? `${chosen.width}w` : `${chosen.width}w, narrower than ${PHOTO_WIDTH}` };
}

const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const listTally = (map) => [...map].map(([key, count]) => `${key} ${count}`).join(', ') || 'none';

export function parseListing(pages, { vendor, catalog }) {
  const names = new Map();
  for (const html of pages) for (const [slug, name] of categoryNames(html, catalog.siteUrl)) if (!names.has(slug)) names.set(slug, name);
  const excluded = Object.fromEntries(EXCLUSIONS.map((reason) => [reason, 0]));
  const seen = new Map();
  const items = [];
  const images = new Map();
  const materialSlugs = new Map();
  const unknownSlugs = new Map();
  const prices = new Map();
  const variants = new Map();
  const flags = [];
  const leftOut = [];
  let cards = 0;
  pages.forEach((html, index) => {
    for (const card of cardsOf(html)) {
      cards += 1;
      const page = index + 1;
      const postId = card.classes.find((name) => /^post-\d+$/.test(name))?.slice('post-'.length);
      const link = card.html.match(/<h2 class="product-title">\s*<a\b([^>]*)>([\s\S]*?)<\/a>/);
      if (!postId || !link) throw new Error(`A card on page ${page} has no post id or no title link; the page layout has changed.`);
      const url = attribute(`<a${link[1]}>`, 'href');
      const name = textOf(link[2]);
      if (!url?.startsWith(catalog.sourceUrl)) throw new Error(`Post ${postId} on page ${page} links to ${url}, outside ${catalog.sourceUrl}.`);
      if (seen.has(postId)) {
        excluded.repeated += 1;
        flags.push(`listing drift: post ${postId} ("${name}") is on page ${seen.get(postId)} and again on page ${page}; kept once`);
        continue;
      }
      seen.set(postId, page);
      if (!card.classes.includes('instock')) {
        excluded['not in stock'] += 1;
        continue;
      }
      const slugs = card.classes.filter((name) => name.startsWith('product_cat-')).map((name) => name.slice('product_cat-'.length)).filter((slug) => !FULFILLMENT.has(slug));
      const categories = [];
      for (const slug of slugs) {
        if (names.has(slug)) categories.push(names.get(slug));
        else tally(unknownSlugs, slug);
      }
      if (slugs.length && slugs.every((slug) => BUILDING_MATERIAL_CATEGORIES.has(slug))) {
        excluded['building material'] += 1;
        for (const slug of slugs) tally(materialSlugs, `${BUILDING_MATERIAL_CATEGORIES.get(slug)} (${slug})`);
        leftOut.push(`  post ${postId} · ${name} · ${categories.join(', ')}`);
        continue;
      }
      if (!slugs.length) flags.push(`post ${postId} ("${name}") has no category besides how it is sold`);
      const era = titleEra(name);
      const price = priceOf(card.html);
      tally(prices, price.kind);
      const photo = photoOf(card.html);
      tally(variants, photo.variant);
      if (photo.url && new URL(photo.url, catalog.siteUrl).hostname !== new URL(catalog.siteUrl).hostname) flags.push(`post ${postId}'s photo is not on ${new URL(catalog.siteUrl).hostname}: ${photo.url}`);
      const key = siteKey(vendor.keyPrefix, postId);
      items.push({
        key,
        vendor: vendor.id,
        catalog: catalog.id,
        name,
        description: null,
        categories,
        era,
        decades: eraDecades(era),
        url,
        ...(price.price ? { listedPrice: price.price } : {}),
      });
      images.set(key, { urls: photo.url ? [new URL(photo.url, catalog.siteUrl).href] : [] });
    }
  });
  const counts = { pages: pages.length, cards, items: items.length, excluded };
  const report = [
    `Pages walked: ${pages.length}, each reached by the page before's own next link; cards: ${cards}; items kept: ${items.length}; excluded: ${EXCLUSIONS.map((reason) => `${reason} ${excluded[reason]}`).join(', ')}`,
    `Left out as building material, per category (a card counts under each of its building-material categories): ${listTally(materialSlugs)}`,
    `Categories named on the pages: ${names.size}. Category slugs on cards that no page names, left out of the item's categories: ${listTally(unknownSlugs)}`,
    `Prices kept as listedPrice (never shown): ${(prices.get('price') ?? 0) + (prices.get('sale') ?? 0)}, of which sale prices (the current price kept): ${prices.get('sale') ?? 0}; price ranges, no price kept: ${prices.get('range') ?? 0}; no price: ${prices.get('none') ?? 0}`,
    `Photo variant used: ${listTally(variants)}`,
    `Items with an era in their name: ${items.filter((item) => item.era).length}`,
    ...(flags.length ? ['Flags:', ...flags.map((flag) => `  ${flag}`)] : ['Flags: none']),
    'Left out as building material (post · name · categories):',
    ...leftOut,
    'Items (key · name · categories · era · listed price):',
    ...items.map((item) => `  ${item.key} · ${item.name} · ${item.categories.join(', ') || 'no category'} · ${item.era ?? 'no era'} · ${item.listedPrice ?? 'no price'}`),
  ];
  return { items, images, counts, report };
}
