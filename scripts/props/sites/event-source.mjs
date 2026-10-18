import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';
import { attribute, decodeEntities, visibleText } from './html-text.mjs';
import { titleEra } from './retro-on-8th.mjs';

// Event Source's Magento 2 store: category pages, each listing its products as `a.product-item-link` anchors under a
// heading, with a toolbar that counts them. A page past the first would need a query, which robots.txt refuses, so every
// category must fit on its first page.
// A class attribute holding the token among its classes, so "page-title-wrapper" is not "page-title".
const HEADING = /<h1\b[^>]*\sclass="(?:[^"]*\s)?page-title(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/h1>/i;
const TOOLBAR = /<p\b[^>]*\sclass="(?:[^"]*\s)?toolbar-amount(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/p>/gi;
// Magento's three forms: "33 Items", "1 Item", and "Items 1-96 of 120" when a category runs past one page.
const TOOLBAR_FORMS = [/^(\d+) Items?$/, /^Items \d+-\d+ of (\d+)$/];
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const PRODUCT_LINK = /\sclass="(?:[^"]*\s)?product-item-link(?:\s[^"]*)?"/i;
const ENTITY = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i;

export const sitemapLocs = (xml) => new Set([...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map(([, loc]) => decodeEntities(loc)));

// Every page in the catalog's list must be one the sitemap lists, a plain page on the site's host with no query or
// fragment, so a typo or a guessed URL stops the import before any page is requested.
export function checkPages(pages, sitemap, siteUrl) {
  const site = new URL(siteUrl);
  if (!Array.isArray(pages) || !pages.length) throw new Error('The catalog lists no category pages.');
  if (new Set(pages).size !== pages.length) throw new Error('The catalog lists a category page twice; stopping before any page request.');
  const locs = sitemapLocs(sitemap);
  for (const page of pages) {
    let url = null;
    try {
      url = new URL(page);
    } catch {
      // Reported below, with the page.
    }
    if (!url || url.href !== page || url.origin !== site.origin || url.search || url.hash) throw new Error(`"${page}" is not a plain page on ${site.host}; stopping before any page request.`);
    if (!locs.has(page)) throw new Error(`${page} is not in the sitemap; stopping before any page request.`);
  }
}

// The total a page's toolbars give. Every toolbar must read the same total in a form this import knows.
function toolbarTotal(html, url) {
  const totals = [...html.matchAll(TOOLBAR)].map(([, inner]) => {
    const text = visibleText(inner);
    const total = TOOLBAR_FORMS.map((form) => text.match(form)?.[1]).find(Boolean);
    if (!total) throw new Error(`${url}: its item count reads "${text}", a form this import doesn't read; stopping.`);
    return Number(total);
  });
  if (!totals.length) throw new Error(`${url} shows no item count; the page layout has changed. Stopping.`);
  if (new Set(totals).size > 1) throw new Error(`${url} shows item counts that disagree (${totals.join(', ')}); stopping.`);
  return totals[0];
}

// One category page, checked as it arrives: its heading, and each product link with its name, which must number exactly
// the toolbar's total. A product link off the site's host or with a query or fragment stops the import, and so do a name
// with an entity left in it and a product linked twice. The link is kept as the URL parser writes it, so a raw space in a
// path reads %20.
export function categoryPage(html, url, siteUrl) {
  const site = new URL(siteUrl);
  const heading = visibleText(html.match(HEADING)?.[1] ?? '');
  if (!heading) throw new Error(`${url} has no category heading; the page layout has changed. Stopping.`);
  const total = toolbarTotal(html, url);
  const products = [...html.matchAll(ANCHOR)].filter(([, attributes]) => PRODUCT_LINK.test(attributes)).map(([, attributes, inner]) => {
    const name = visibleText(inner);
    const href = attribute(`<a ${attributes}>`, 'href');
    let link = null;
    try {
      link = new URL(href ?? '', url);
    } catch {
      // Reported below, with the product.
    }
    if (!link || link.origin !== site.origin) throw new Error(`The product "${name}" on ${url} links ${href}, not a page on ${site.host}; stopping.`);
    if (link.search || link.hash) throw new Error(`The product link of "${name}" on ${url} carries a query or fragment; a URL with a query is never stored. Stopping.`);
    if (!name) throw new Error(`A product link on ${url} has no name; the page layout has changed. Stopping.`);
    const entity = name.match(ENTITY);
    if (entity) throw new Error(`The product name "${name}" on ${url} holds ${entity[0]}, an entity this import can't decode; stopping.`);
    return { name, path: link.pathname, url: `${link.origin}${link.pathname}` };
  });
  const paths = products.map((product) => product.path);
  const twice = paths.find((path, index) => paths.indexOf(path) !== index);
  if (twice) throw new Error(`${url} links the product ${twice} twice; the page layout has changed. Stopping.`);
  if (products.length !== total) {
    const why = products.length < total ? 'a category must fit on its first page, since a page past the first needs a query robots.txt refuses' : 'the page layout has changed';
    throw new Error(`${url} lists ${products.length} products, but its item count says ${total}; ${why}. Stopping.`);
  }
  return { url, heading, products };
}

// Items from the checked category pages, in page order. The same product on two pages is one item, with both
// categories in page order and the first page's name; two product pages with one name stay two items. No price,
// description or photo is kept: every photo the site publishes carries a query.
export function parseCategories(pages, { vendor, catalog }) {
  const products = new Map();
  for (const page of pages) {
    for (const product of page.products) {
      const known = products.get(product.path);
      if (!known) {
        products.set(product.path, { ...product, categories: [page.heading], otherNames: [], listings: 1 });
        continue;
      }
      if (!known.categories.includes(page.heading)) known.categories.push(page.heading);
      if (product.name !== known.name && !known.otherNames.includes(product.name)) known.otherNames.push(product.name);
      known.listings += 1;
    }
  }
  const flags = [];
  const items = [];
  const images = new Map();
  for (const product of products.values()) {
    const key = siteKey(vendor.keyPrefix, product.path);
    const era = titleEra(product.name);
    if (product.listings > 1) flags.push(`${key} "${product.name}" is listed on ${product.listings} category pages (${product.categories.join(', ')}); one item`);
    if (product.otherNames.length) flags.push(`${key} "${product.name}" is also named ${product.otherNames.map((name) => `"${name}"`).join(', ')} on a later page; the first page's name is kept`);
    items.push({ key, vendor: vendor.id, catalog: catalog.id, name: product.name, description: null, categories: product.categories, era, decades: eraDecades(era), url: product.url });
    images.set(key, { urls: [] });
  }
  for (const [name, named] of Map.groupBy(items, (item) => item.name)) {
    if (named.length > 1) flags.push(`"${name}" names ${named.length} product pages (${named.map((item) => item.key).join(', ')}); items merge by product page, so they stay ${named.length} items`);
  }
  const listed = pages.reduce((total, page) => total + page.products.length, 0);
  const counts = { pages: pages.length, products: listed, items: items.length, merged: listed - items.length };
  const report = [
    `Pages: ${pages.length}; products listed: ${listed}; items: ${items.length}; listings merged into an item from an earlier page: ${counts.merged}`,
    ...pages.map((page) => `  ${page.heading}: ${page.products.length} products (${new URL(page.url).pathname})`),
    `Product links with an encoded character in their path, kept as the URL parser writes them: ${items.filter((item) => /%[0-9a-f]{2}/i.test(item.url)).length}`,
    'Photos: none (every published photo URL carries a query, so the catalog is text-only)',
    `Items with an era in their name: ${items.filter((item) => item.era).length}`,
    ...(flags.length ? ['Flags:', ...flags.map((flag) => `  ${flag}`)] : ['Flags: none']),
    'Items (key · name · categories):',
    ...items.map((item) => `  ${item.key} · ${item.name} · ${item.categories.join(', ')}`),
  ];
  return { items, images, counts, report };
}
