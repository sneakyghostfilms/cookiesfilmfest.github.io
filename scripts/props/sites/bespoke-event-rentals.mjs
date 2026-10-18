import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';
import { attribute, decodeEntities, visibleText } from './html-text.mjs';
import { titleEra } from './retro-on-8th.mjs';

// Bespoke Event Rentals' TapGoods catalog on WordPress: collection pages whose tiles link their subcategory pages, and
// subcategory pages whose tiles are the products, with a name, a product link and a photo each.
export const PHOTO_HOST = 's3.us-east-1.amazonaws.com';
// The regional host serves every bucket, so the vendor's own bucket is pinned by the path.
export const PHOTO_BUCKET = '/tapg-prd-usea1-public-l4eq/';
export const SUBCATEGORY_PAGE_LIMIT = 10;
const TILE = /<div class="catalog-item">\s*<a href="([^"]*)">\s*(<img\b[^>]*>)\s*<\/a>\s*<div class="caption\b[^"]*">([\s\S]*?)<\/div>/gi;
const PRICE_LINE = /^\$\s*\d|\/\s*unit price$/i;

// A photo is accepted only on TapGoods' public bucket, with a query of digits alone: the image's version stamp, a Unix
// time that is the same for every visitor, so it can't carry a stranger's named token from a page cache.
export function photoProblem(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'is not a URL';
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== PHOTO_HOST) return `is not on ${PHOTO_HOST}`;
  if (!parsed.pathname.startsWith(PHOTO_BUCKET)) return `is not in the vendor's bucket ${PHOTO_BUCKET}`;
  if (!/^\?\d+$/.test(parsed.search) || parsed.hash) return 'has a query other than a version stamp of digits alone';
  return null;
}

// Every tile on a page, each with its link, image tag and caption. A tile the pattern misses stops the import, so a
// changed layout can't drop items silently.
function tilesOf(html, pageUrl) {
  const found = (html.match(/class="catalog-item"/g) ?? []).length;
  const tiles = [...html.matchAll(TILE)].map(([, href, image, caption]) => ({ link: new URL(decodeEntities(href), pageUrl), image, name: visibleText(caption) }));
  if (tiles.length !== found) throw new Error(`${pageUrl} has ${found} tiles, ${tiles.length} of them in the layout this import reads; the page layout has changed.`);
  return tiles;
}

const nextLink = (html) => {
  const tag = html.match(/<link\b[^>]*\brel="next"[^>]*>/i)?.[0];
  return tag ? attribute(tag, 'href') : null;
};

// A collection page's subcategory pages, as its tiles link them, kept to the collection's list of slugs in vendors.json.
// A tile linking anything but a page directly under the collection, on the same host, or a listed slug the page doesn't
// link, stops the import before any subcategory request. The page followed is the tile's own link. Tiles not on the
// list come back by name, for the report.
export function subcategoryPages(html, collection) {
  const base = new URL(collection.url);
  const tiles = tilesOf(html, collection.url).map(({ link, name }) => {
    const rest = link.pathname.startsWith(base.pathname) ? link.pathname.slice(base.pathname.length) : '';
    if (link.origin !== base.origin || !/^[a-z0-9-]+\/$/.test(rest) || link.search || link.hash) {
      throw new Error(`A subcategory tile on ${collection.url} links ${link.href}, not a page directly under it; stopping before any subcategory request.`);
    }
    return { url: link.href, label: name, slug: rest.slice(0, -1) };
  });
  if (!tiles.length) throw new Error(`${collection.url} links no subcategory pages; the page layout has changed.`);
  const missing = collection.subcategories.filter((slug) => !tiles.some((tile) => tile.slug === slug));
  if (missing.length) throw new Error(`${collection.url} doesn't link ${missing.join(', ')}, on its list in vendors.json; stopping before any subcategory request.`);
  const listed = (tile) => collection.subcategories.includes(tile.slug);
  return { listed: tiles.filter(listed), skipped: tiles.filter((tile) => !listed(tile)).map((tile) => tile.label) };
}

// The one pager off a subcategory's own path that is recognized: exactly the tag archive of the same slug on the same
// host, /tags/<slug>/page/N+1/ (Bespoke's Chairs page has one). It is not followed; the subcategory keeps the pages read so
// far, and the report names it. Returns that path, or null.
export function tagArchivePager(html, firstUrl, number) {
  const href = nextLink(html);
  if (!href) return null;
  const first = new URL(firstUrl);
  const slug = first.pathname.split('/').filter(Boolean).at(-1);
  const archive = `/tags/${slug}/page/${number + 1}/`;
  return href === `${first.origin}${archive}` ? archive : null;
}

// A subcategory page's next page, followed only when it is the same path plus page/N/, N the next number, up to
// SUBCATEGORY_PAGE_LIMIT pages. The tag-archive pager above is not followed. Any other next link is a layout change and
// stops the import.
export function nextSubcategoryPage(html, firstUrl, number) {
  const href = nextLink(html);
  if (!href || tagArchivePager(html, firstUrl, number)) return null;
  const expected = `${firstUrl}page/${number + 1}/`;
  if (href !== expected) throw new Error(`${firstUrl}: page ${number} names its next page as ${href}, not ${expected}; stopping.`);
  if (number + 1 > SUBCATEGORY_PAGE_LIMIT) throw new Error(`${firstUrl} goes on past ${SUBCATEGORY_PAGE_LIMIT} pages; stopping before page ${number + 1}.`);
  return expected;
}

// Items from the subcategory pages, in page order. The same product on two subcategory pages is one item, with both
// categories in page order and the first page's link; two product pages with one name stay two items. The price under
// a name is never kept. `collections` are the catalog's collections, each with its page's html, for the report.
export function parseCatalog({ collections, pages }, { vendor, catalog }) {
  const site = new URL(catalog.siteUrl);
  const flags = [];
  const products = new Map();
  const perHeading = new Map();
  const photoHosts = new Map();
  let tileCount = 0;
  for (const page of pages) {
    const heading = visibleText(page.html.match(/<h1\b[^>]*class="tag-title"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
    if (!heading) throw new Error(`${page.url} has no subcategory heading; the page layout has changed.`);
    const tiles = tilesOf(page.html, page.url);
    tileCount += tiles.length;
    const archive = page.subcategory ? tagArchivePager(page.html, page.subcategory, page.number) : null;
    if (archive) flags.push(`${heading}: pager leads to the tag archive ${archive}, not followed`);
    const tally = perHeading.get(heading) ?? { pages: 0, tiles: 0 };
    tally.pages += 1;
    tally.tiles += tiles.length;
    perHeading.set(heading, tally);
    for (const tile of tiles) {
      const slug = tile.link.pathname.match(/^\/products\/([a-z0-9-]+)\/$/)?.[1];
      if (tile.link.origin !== site.origin || !slug) throw new Error(`A product tile on ${page.url} links ${tile.link.origin}${tile.link.pathname}, not a product page on ${site.host}; stopping.`);
      if (tile.link.search) throw new Error(`The product link of "${tile.name}" carries a query (${[...tile.link.searchParams.keys()].join(', ')}); a URL with a query is never stored.`);
      if (!tile.name || PRICE_LINE.test(tile.name)) throw new Error(`A product tile on ${page.url} has the caption "${tile.name}", not a name; the page layout has changed.`);
      const photo = attribute(tile.image, 'src');
      const problem = photo ? photoProblem(photo) : null;
      if (problem) throw new Error(`The photo of "${tile.name}" ${problem}; stopping.`);
      const host = photo ? new URL(photo).hostname : 'no photo';
      photoHosts.set(host, (photoHosts.get(host) ?? 0) + 1);
      const known = products.get(slug);
      if (known) {
        if (!known.categories.includes(heading)) known.categories.push(heading);
        known.tiles += 1;
        continue;
      }
      products.set(slug, { slug, name: tile.name, categories: [heading], url: `${site.origin}${tile.link.pathname}`, photo, tiles: 1 });
    }
  }
  const items = [];
  const images = new Map();
  for (const product of products.values()) {
    const key = siteKey(vendor.keyPrefix, product.slug);
    const era = titleEra(product.name);
    if (product.tiles > 1) flags.push(`${key} "${product.name}" appears on ${product.tiles} subcategory pages (${product.categories.join(', ')}); one item`);
    if (!product.photo) flags.push(`${key} "${product.name}" has no photo`);
    items.push({ key, vendor: vendor.id, catalog: catalog.id, name: product.name, description: null, categories: product.categories, era, decades: eraDecades(era), url: product.url });
    images.set(key, { urls: product.photo ? [product.photo] : [] });
  }
  for (const [name, named] of Map.groupBy(items, (item) => item.name)) {
    if (named.length > 1) flags.push(`"${name}" names ${named.length} product pages (${named.map((item) => item.key).join(', ')}); items merge by product page, so they stay ${named.length} items`);
  }
  const counts = { pages: pages.length, tiles: tileCount, items: items.length, merged: tileCount - items.length };
  const report = [
    `Collection pages: ${collections.length}`,
    ...collections.map((collection) => {
      const { listed, skipped } = subcategoryPages(collection.html, collection);
      const next = nextLink(collection.html);
      const tiles = listed.length + skipped.length;
      return `  ${collection.url}: ${tiles} subcategory ${tiles === 1 ? 'tile' : 'tiles'}, ${listed.length} on the list${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}${next ? `; its own next page (${next}) is not followed, since its first page lists every subcategory` : ''}`;
    }),
    `Pages: ${pages.length}; tiles: ${tileCount}; items: ${items.length}; tiles merged into an item from an earlier page: ${counts.merged}`,
    ...[...perHeading].map(([heading, { pages: count, tiles }]) => `  ${heading}: ${tiles} tiles on ${count} page${count === 1 ? '' : 's'}`),
    `Photo hosts: ${[...photoHosts].map(([host, count]) => `${host} ${count}`).join(', ') || 'none'}`,
    `Items with an era in their name: ${items.filter((item) => item.era).length}`,
    ...(flags.length ? ['Flags:', ...flags.map((flag) => `  ${flag}`)] : ['Flags: none']),
    'Items (key · name · categories):',
    ...items.map((item) => `  ${item.key} · ${item.name} · ${item.categories.join(', ')}`),
  ];
  return { items, images, counts, report };
}
