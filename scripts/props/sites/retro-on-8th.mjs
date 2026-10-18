import { parseCsv } from '../csv.mjs';
import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';

export const COLUMNS = {
  handle: ['URL handle', 'Handle'],
  title: ['Title'],
  type: ['Type'],
  tags: ['Tags'],
  published: ['Published on online store', 'Published'],
  status: ['Status'],
  price: ['Price', 'Variant Price'],
  image: ['Product image URL', 'Image Src'],
  imagePosition: ['Image position', 'Image Position'],
  giftCard: ['Gift card', 'Gift Card'],
  stockTracker: ['Inventory tracker', 'Variant Inventory Tracker'],
  stockQuantity: ['Inventory quantity', 'Variant Inventory Qty'],
  stockPolicy: ['Continue selling when out of stock', 'Variant Inventory Policy'],
};
const REQUIRED = ['handle', 'title', 'type', 'tags', 'published', 'status', 'price', 'image', 'imagePosition', 'giftCard'];
const STOCK = ['stockTracker', 'stockQuantity', 'stockPolicy'];
const PRODUCT_FIELDS = ['title', 'type', 'tags', 'published', 'status', 'giftCard'];
const SOLD_MARKERS = new Set(['sold items', 'sold', 'sold-items']);
const DECADE = String.raw`(?:['’]?[2-9]0|1[89]\d0|20[0-2]0)['’]?s`;
const DECADE_RANGE = new RegExp(String.raw`(?<![\p{L}\p{N}'’])${DECADE}(?:\s*[-–—/]\s*${DECADE})*(?![\p{L}\p{N}])`, 'iu');
const YEAR = /(?<![\p{L}\p{N}'’.\/-])(?:19\d{2}|20[0-2]\d)(?![\p{L}\p{N}'’\/-])/u;
const EXCLUSIONS = ['not active', 'not published', 'marked sold', 'sold out', 'gift card'];
export const IMAGE_HOST = 'cdn.shopify.com';
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export function titleEra(title) {
  return title.match(DECADE_RANGE)?.[0] ?? title.match(YEAR)?.[0] ?? null;
}

export function resolveColumns(header) {
  const seen = new Set();
  for (const name of header) {
    if (seen.has(name)) throw new Error(`The export has the column "${name}" twice.`);
    seen.add(name);
  }
  const index = {};
  for (const [column, names] of Object.entries(COLUMNS)) {
    const present = [...new Set(names)].filter((name) => seen.has(name));
    if (present.length > 1) throw new Error(`The export has both "${present.join('" and "')}"; keep one.`);
    if (!present.length && REQUIRED.includes(column)) throw new Error(`The export has no ${names.map((name) => `"${name}"`).join(' or ')} column.`);
    index[column] = present.length ? header.indexOf(present[0]) : null;
  }
  return index;
}

const isTrue = (value) => value.trim().toLowerCase() === 'true';
const tagList = (value) => value.split(',').map((tag) => tag.trim()).filter(Boolean);

function groupRows(rows, index) {
  const groups = [];
  const finished = new Set();
  for (const [offset, row] of rows.entries()) {
    const handle = (row[index.handle] ?? '').trim();
    if (!handle) throw new Error(`Export row ${offset + 2} has no handle.`);
    if (!HANDLE.test(handle)) throw new Error(`Export row ${offset + 2} has the handle "${handle}"; Shopify handles hold only letters, numbers and dashes.`);
    const current = groups.at(-1);
    if (current?.handle === handle) {
      current.rows.push(row);
      continue;
    }
    if (finished.has(handle)) throw new Error(`The handle "${handle}" appears again in a later block (row ${offset + 2}).`);
    if (current) finished.add(current.handle);
    groups.push({ handle, rows: [row] });
  }
  return groups;
}

function productOf({ handle, rows }, index) {
  const value = (row, column) => (index[column] === null ? '' : (row[index[column]] ?? '').trim());
  const [first] = rows;
  if (!value(first, 'title')) throw new Error(`The first row of "${handle}" has no title.`);
  for (const row of rows.slice(1)) {
    for (const field of PRODUCT_FIELDS) {
      const repeated = value(row, field);
      if (repeated && repeated !== value(first, field)) throw new Error(`A later row of "${handle}" gives a different ${field}.`);
    }
  }
  const variants = rows.filter((row) => value(row, 'price'));
  const images = rows.filter((row) => value(row, 'image'))
    .map((row, order) => ({ url: value(row, 'image'), position: Number(value(row, 'imagePosition')) || Infinity, order }))
    .sort((a, b) => a.position - b.position || a.order - b.order);
  const stockKnown = STOCK.every((column) => index[column] !== null);
  const soldOut = stockKnown && variants.length > 0 && variants.every((row) => {
    const quantity = value(row, 'stockQuantity');
    return value(row, 'stockTracker') !== '' && quantity !== '' && Number(quantity) <= 0 && value(row, 'stockPolicy').toLowerCase() === 'deny';
  });
  const type = value(first, 'type');
  const tags = tagList(value(first, 'tags'));
  return {
    handle,
    title: value(first, 'title'),
    type,
    tags,
    status: value(first, 'status').toLowerCase(),
    published: isTrue(value(first, 'published')),
    giftCard: isTrue(value(first, 'giftCard')) || type.toLowerCase() === 'gift card',
    sold: [type, ...tags].some((label) => SOLD_MARKERS.has(label.toLowerCase())),
    soldOut,
    price: variants.length ? value(variants[0], 'price') : null,
    prices: new Set(variants.map((row) => value(row, 'price'))),
    image: images[0]?.url ?? null,
  };
}

function exclusionOf(product) {
  if (product.status !== 'active') return 'not active';
  if (!product.published) return 'not published';
  if (product.sold) return 'marked sold';
  if (product.soldOut) return 'sold out';
  if (product.giftCard) return 'gift card';
  return null;
}

export function parseExport(text, { vendor, catalog }) {
  const [header = [], ...body] = parseCsv(text);
  const index = resolveColumns(header.map((name) => name.trim()));
  const rows = body.filter((row) => row.some((cell) => cell.trim() !== ''));
  const products = groupRows(rows, index).map((group) => productOf(group, index));
  const excluded = Object.fromEntries(EXCLUSIONS.map((reason) => [reason, 0]));
  const items = [];
  const images = new Map();
  for (const product of products) {
    const reason = exclusionOf(product);
    if (reason) {
      excluded[reason] += 1;
      continue;
    }
    const key = siteKey(vendor.keyPrefix, product.handle);
    const era = titleEra(product.title);
    const categories = [...new Set([product.type, ...product.tags].filter((label) => label && !SOLD_MARKERS.has(label.toLowerCase())))];
    items.push({
      key,
      vendor: vendor.id,
      catalog: catalog.id,
      name: product.title,
      description: null,
      categories,
      era,
      decades: eraDecades(era),
      url: `${catalog.siteUrl}${product.handle}`,
      ...(product.price === null ? {} : { listedPrice: product.price }),
    });
    images.set(key, { urls: product.image ? [product.image] : [] });
  }
  const stockKnown = STOCK.every((column) => index[column] !== null);
  const counts = { products: products.length, items: items.length, excluded };
  const report = [
    `Products: ${products.length} (${rows.length} rows); items kept: ${items.length}`,
    `Excluded: ${EXCLUSIONS.map((reason) => `${reason} ${excluded[reason]}`).join(', ')}`,
    stockKnown ? 'Sold-out rule applied (stock columns present; their values are never stored).' : 'Sold-out rule skipped: the export has no complete set of stock columns.',
    `Items with no category: ${items.filter((item) => !item.categories.length).length}; with no image: ${[...images.values()].filter((entry) => !entry.urls.length).length}`,
    `Products whose variants have different prices (the first is kept): ${products.filter((product) => !exclusionOf(product) && product.prices.size > 1).length}`,
    `First images not on ${IMAGE_HOST}, which stop the demo's photo download: ${[...images.values()].filter((entry) => entry.urls.length && new URL(entry.urls[0]).hostname !== IMAGE_HOST).length}`,
    'Items (key · name · era · categories):',
    ...items.map((item) => `  ${item.key} · ${item.name} · ${item.era ?? 'no era'} · ${item.categories.join(' / ') || 'none'}`),
  ];
  return { items, images, counts, report };
}
