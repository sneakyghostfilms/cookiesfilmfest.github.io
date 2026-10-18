import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';
import { titleEra } from './retro-on-8th.mjs';

export const STORE_PAGE_LIMIT = 20;
const EXCLUSIONS = ['not in the category', 'not visible', 'not physical', 'sold out', 'listed twice'];

export function storeCategoryId(catalog) {
  return new URL(catalog.listUrl).searchParams.get('categories[]');
}

// Page URLs repeat the first page's query with the next page number: the store's own "next" link drops the query.
export function storeListPage(catalog, page) {
  return `${catalog.listUrl}&page=${page}`;
}

export function storePageCount(listing) {
  const pages = listing?.meta?.pagination?.total_pages;
  if (!Number.isInteger(pages) || pages < 1 || pages > STORE_PAGE_LIMIT) {
    throw new Error(`The store's product list gives total_pages ${JSON.stringify(pages)}; expected a whole number from 1 to ${STORE_PAGE_LIMIT}.`);
  }
  return pages;
}

export function storeCategoryName(html, categoryId) {
  const line = String(html).split('\n').find((text) => text.includes('window.__BOOTSTRAP_STATE__ ='));
  const state = line ? JSON.parse(line.slice(line.indexOf('=') + 1).trim().replace(/;$/, '')) : null;
  const name = state?.commerceLinks?.categories?.[categoryId]?.name;
  if (typeof name !== 'string' || !name.trim()) throw new Error(`The category page names no category ${categoryId}.`);
  return name.trim();
}

function soldOut(product) {
  const inventory = product.inventory ?? {};
  if (product.badges?.out_of_stock || inventory.all_variations_sold_out || inventory.marked_sold_out_at_all_existing_locations) return true;
  return typeof inventory.total === 'number' && inventory.total <= 0 && !inventory.has_location_not_tracking;
}

const plainAmount = (subunits) => `${Math.floor(subunits / 100)}.${String(subunits % 100).padStart(2, '0')}`;

export function parseStore(categoryHtml, listings, { vendor, catalog }) {
  const categoryId = storeCategoryId(catalog);
  const category = storeCategoryName(categoryHtml, categoryId);
  const pagination = listings.map((listing) => listing?.meta?.pagination ?? {});
  pagination.forEach((page, index) => {
    if (page.current_page !== index + 1 || page.total_pages !== listings.length || page.total !== pagination[0].total) {
      throw new Error(`Page ${index + 1} of the store's product list says it is page ${page.current_page} of ${page.total_pages}, ${page.total} products; the pages don't agree.`);
    }
  });
  const excluded = Object.fromEntries(EXCLUSIONS.map((reason) => [reason, 0]));
  const seen = new Set();
  const items = [];
  const images = new Map();
  const notes = { soldBySignal: 0, soldByCount: 0, untracked: 0, untrackedAtZero: 0, priceRanges: 0, noPrice: 0, photosElsewhere: 0, noPhoto: 0 };
  for (const product of listings.flatMap((listing) => listing.data ?? [])) {
    const inventory = product.inventory ?? {};
    let reason = null;
    if (seen.has(product.id)) reason = 'listed twice';
    else if (!(product.categoryIds ?? []).includes(categoryId)) reason = 'not in the category';
    else if (product.visibility !== 'visible') reason = 'not visible';
    else if (product.product_type !== 'physical') reason = 'not physical';
    else if (soldOut(product)) reason = 'sold out';
    seen.add(product.id);
    if (reason) {
      excluded[reason] += 1;
      if (reason === 'sold out') notes[product.badges?.out_of_stock || inventory.all_variations_sold_out || inventory.marked_sold_out_at_all_existing_locations ? 'soldBySignal' : 'soldByCount'] += 1;
      continue;
    }
    if (inventory.has_location_not_tracking) {
      notes.untracked += 1;
      if (typeof inventory.total === 'number' && inventory.total <= 0) notes.untrackedAtZero += 1;
    }
    const name = String(product.name ?? '').trim();
    const key = siteKey(vendor.keyPrefix, product.id);
    const era = titleEra(name);
    const low = product.price?.low_subunits;
    if (Number.isInteger(low) && product.price.high_subunits !== low) notes.priceRanges += 1;
    if (!Number.isInteger(low)) notes.noPrice += 1;
    items.push({
      key,
      vendor: vendor.id,
      catalog: catalog.id,
      name,
      description: null,
      categories: [category],
      era,
      decades: eraDecades(era),
      url: product.absolute_site_link,
      ...(Number.isInteger(low) ? { listedPrice: plainAmount(low) } : {}),
    });
    const photo = product.thumbnail?.data?.absolute_urls?.['640'] ?? null;
    if (!photo) notes.noPhoto += 1;
    else if (new URL(photo).hostname !== catalog.photoHost) notes.photosElsewhere += 1;
    images.set(key, { urls: photo ? [photo] : [] });
  }
  const counts = { products: seen.size, items: items.length, excluded };
  const report = [
    `Category "${category}" (id ${categoryId}): ${pagination[0].total} products on ${listings.length} pages. Each page URL repeats the first page's query with the page number, because the store's own next link drops the query; that link is never followed.`,
    `Products: ${counts.products}; items kept: ${items.length}; excluded: ${EXCLUSIONS.map((name) => `${name} ${excluded[name]}`).join(', ')}`,
    `Sold out by the store's badge or flags: ${notes.soldBySignal}; by a tracked stock count of 0 alone: ${notes.soldByCount}. Kept with untracked stock: ${notes.untracked} (stock count 0: ${notes.untrackedAtZero}). Stock values are never stored.`,
    `Prices kept as listedPrice (never shown): ${items.length - notes.noPrice}; with a price range, the lowest kept: ${notes.priceRanges}; with no price: ${notes.noPrice}`,
    `Photos: ${items.length - notes.noPhoto} at 640 px; not on ${catalog.photoHost}, which stops the demo's photo download: ${notes.photosElsewhere}; items with no photo: ${notes.noPhoto}`,
    `Items with an era in their name: ${items.filter((item) => item.era).length}`,
    'Items (key · name · era · listed price):',
    ...items.map((item) => `  ${item.key} · ${item.name} · ${item.era ?? 'no era'} · ${item.listedPrice ?? 'no price'}`),
  ];
  return { items, images, counts, report };
}
