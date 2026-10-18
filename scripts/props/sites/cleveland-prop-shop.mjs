import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';
import { attribute, visibleText } from './html-text.mjs';
import { titleEra } from './retro-on-8th.mjs';

// The menu group whose sub-pages are the category galleries, and the top-level pages indexed beside them. For Sale
// holds the only breakaway glass in the inventory (the lead's ruling, 2026-10-18).
export const CATEGORY_MENU = 'Props';
export const EXTRA_PAGES = ['For Sale'];
const PHOTO_WIDTH = 320;
// A caption that ends in a price, "$20 each" or "$22 each.", keeps it as listedPrice, which the page never shows.
const EACH_PRICE = /\s*\$(\d+(?:\.\d{2})?)\s+each\.?$/i;
const ANY_PRICE = /\$\s*\d/;
// A round century written as a decade ("early 1900s") can mean the century or its first decade. The decade filter would
// read it as the decade, so such a caption gets no era (the lead's ruling, 2026-10-18).
const ROUND_CENTURY = /\d\d00['’]?s/i;

// Weebly names a second upload of a file "name_1_orig.jpg" beside "name_orig.jpg", so a trailing _N is set aside when
// photo files are compared (the lead's ruling, 2026-10-18): a re-upload is the same photo.
const sameFile = (file) => file.replace(/_\d+(?=(?:_orig)?\.[a-z0-9]+$)/i, '');
const tidy = (text) => String(text).replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))];
const classesOf = (tag) => (attribute(tag, 'class') ?? '').split(/\s+/).filter(Boolean);

// The pages to read, from the site's menu: the sub-pages of CATEGORY_MENU in order, then EXTRA_PAGES. The desktop and
// mobile menus repeat the same links, so each page counts once. Every link must be a page on the site, ending .html,
// with no query or fragment; no page URL is built.
export function galleryPages(html, siteUrl) {
  const site = new URL(siteUrl);
  const pages = [];
  let group = null;
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = `<a${match[1]}>`;
    const classes = classesOf(tag);
    const top = classes.includes('wsite-menu-item');
    if (!top && !classes.includes('wsite-menu-subitem')) continue;
    const label = visibleText(match[2]);
    if (top) group = label;
    if (top ? !EXTRA_PAGES.includes(label) : group !== CATEGORY_MENU) continue;
    const href = attribute(tag, 'href') ?? '';
    const url = new URL(href, site);
    if (url.origin !== site.origin || !/^\/[^/]+\.html$/.test(url.pathname) || url.search || url.hash) {
      throw new Error(`The menu links "${label}" to ${url.origin}${url.pathname}${url.search ? ' with a query' : ''}${url.hash ? ' with a fragment' : ''}, not a page on ${site.host}; stopping before any request.`);
    }
    if (!pages.some((page) => page.url === url.href)) pages.push({ label, url: url.href, slug: url.pathname.slice(1, -'.html'.length) });
  }
  const groups = pages.filter((page) => !EXTRA_PAGES.includes(page.label));
  if (!groups.length) throw new Error(`The menu has no "${CATEGORY_MENU}" pages; stopping before any request.`);
  for (const label of EXTRA_PAGES) if (!pages.some((page) => page.label === label)) throw new Error(`The menu has no "${label}" page; stopping before any request.`);
  return pages;
}

// The category is the banner heading inside the page's header section, or else its <title>. The menu's own label is
// not used: it can differ (the furniture page is labelled "office").
function categoryOf(html) {
  const header = [...html.matchAll(/<div\b[^>]*>/gi)].find(([tag]) => classesOf(tag).includes('wsite-header-section'));
  const content = html.indexOf('id="wsite-content"');
  const banner = header ? html.slice(header.index, content > header.index ? content : html.length) : '';
  const heading = banner.match(/<h2\b[^>]*class="wsite-content-title"[^>]*>([\s\S]*?)<\/h2>/);
  const title = visibleText(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  return { heading: heading ? visibleText(heading[1]) : '', title };
}

// Each photo in the page's galleries: the caption is the lightbox link's title; the photo is the gallery's own thumbnail
// when it is at least PHOTO_WIDTH wide, or else the full-size original the link opens.
function photosOf(html, pageUrl) {
  return tagsOf(html, 'a').filter(([tag]) => /^lightbox\[gallery\d+\]$/.test(attribute(tag, 'rel') ?? '')).map((match) => {
    const [anchor] = match;
    const image = html.slice(match.index, html.indexOf('</a>', match.index)).match(/<img\b[^>]*>/i)?.[0] ?? '';
    // A gallery can also print the caption under the photo; the next photo's container ends this one.
    const next = html.indexOf('-imageContainer', match.index);
    const shown = html.slice(match.index, next < 0 ? html.length : next).match(/class=['"]galleryCaptionInnerText['"][^>]*>([\s\S]*?)<\/div>/);
    const original = new URL(attribute(anchor, 'href') ?? '', pageUrl);
    const source = attribute(image, 'src');
    const thumbnail = source ? new URL(source, pageUrl) : null;
    const width = Number.parseInt(attribute(image, '_width') ?? '', 10);
    for (const url of [original, thumbnail].filter(Boolean)) {
      if (url.search) throw new Error(`A photo on ${pageUrl} has a URL with a query (${[...url.searchParams.keys()].join(', ')}); a URL with a query is never stored.`);
    }
    const useThumbnail = thumbnail && width >= PHOTO_WIDTH;
    return {
      caption: tidy(attribute(anchor, 'title') ?? ''),
      file: original.pathname.split('/').pop(),
      url: (useThumbnail ? thumbnail : original).href,
      variant: useThumbnail ? 'thumbnail' : Number.isFinite(width) ? `original (thumbnail narrower than ${PHOTO_WIDTH} px)` : 'original (no thumbnail width)',
      alt: Boolean(tidy(attribute(image, 'alt') ?? '')),
      shown: shown ? visibleText(shown[1]) : null,
    };
  });
}

// What else the page's content holds, so the report shows any item that isn't a gallery photo.
function otherContent(html) {
  const start = html.indexOf('id="wsite-content"');
  const end = html.indexOf('class="footer-wrap"', start);
  const content = start < 0 ? '' : html.slice(start, end < 0 ? html.length : end);
  const images = tagsOf(content, 'img').filter(([tag]) => !classesOf(tag).includes('galleryImage')).length;
  const paragraphs = [...content.matchAll(/<div\b[^>]*class="paragraph"[^>]*>([\s\S]*?)<\/div>/gi)].filter(([, inner]) => visibleText(inner)).length;
  return { images, paragraphs };
}

const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

const sharesPhoto = (item, files) => item.photos.some((photo) => files.has(sameFile(photo.file)));
const filesOf = (photos) => new Set(photos.map((photo) => sameFile(photo.file)));

export function parseGalleries(pages, { vendor, catalog }) {
  const flags = [];
  const variants = new Map();
  const items = [];
  const pageInfo = [];
  let photoCount = 0;
  pages.forEach((page, order) => {
    const { heading, title } = categoryOf(page.html);
    const category = heading || title;
    if (!category) throw new Error(`${page.url} has neither a heading nor a title; stopping before the inventory is written.`);
    const photos = photosOf(page.html, page.url);
    if (!heading) flags.push(`${page.url} has no banner heading, so its <title> "${title}" is the category`);
    else if (title && title !== heading) flags.push(`${page.url}: heading "${heading}", <title> "${title}"; the heading is the category`);
    if (page.label !== category) flags.push(`${page.url}: menu label "${page.label}", category "${category}"`);
    photoCount += photos.length;
    pageInfo.push({ page, category, photos, other: otherContent(page.html) });
    const groups = [];
    for (const photo of photos) {
      tally(variants, photo.variant);
      if (photo.shown !== null && photo.shown !== photo.caption) flags.push(`${page.url}: a photo's printed caption "${photo.shown}" differs from its title "${photo.caption}"; the title is used`);
      if (ANY_PRICE.test(photo.caption) && !EACH_PRICE.test(photo.caption)) {
        throw new Error(`A caption on ${page.url} gives a price in a form this import doesn't read: "${photo.caption}"; stopping before the inventory is written.`);
      }
      const price = photo.caption.match(EACH_PRICE)?.[1] ?? null;
      const name = price ? photo.caption.replace(EACH_PRICE, '') : photo.caption;
      if (ANY_PRICE.test(name)) throw new Error(`A caption on ${page.url} gives a second price, which would be shown: "${photo.caption}"; stopping before the inventory is written.`);
      const same = groups.find((group) => (name ? group.name === name : !group.name && sameFile(group.photos[0].file) === sameFile(photo.file)));
      if (same) same.photos.push(photo);
      else groups.push({ name, price, photos: [photo] });
    }
    for (const group of groups) {
      // The same caption and photo on two pages are one item: the first page gives its link and key.
      const files = filesOf(group.photos);
      const earlier = items.find((item) => item.title === group.name && item.sources.every((source) => source.url !== page.url) && sharesPhoto(item, files));
      if (earlier) {
        if (earlier.price !== group.price) flags.push(`"${group.name}": listed again on ${page.url} with another price; the first is kept`);
        merge(earlier, { category, order, url: page.url, photos: group.photos });
        continue;
      }
      items.push({ title: group.name, price: group.price, order, slug: page.slug, url: page.url, categories: [{ category, order }], photos: [...group.photos], sources: [{ url: page.url, category, photos: group.photos.length }] });
    }
  });
  // An untitled photo that a captioned item also shows is that item (the lead's ruling, 2026-10-18): it adds its page.
  for (const untitled of items.filter((item) => !item.title)) {
    const titled = items.find((item) => item.title && sharesPhoto(item, filesOf(untitled.photos)));
    if (!titled) continue;
    merge(titled, { category: untitled.categories[0].category, order: untitled.order, url: untitled.url, photos: untitled.photos, untitled: true });
    items.splice(items.indexOf(untitled), 1);
  }
  const untitledCount = new Map();
  for (const item of items) {
    if (item.title) {
      item.name = item.title;
      item.key = siteKey(vendor.keyPrefix, `${item.slug}|${item.title}`);
    } else {
      const { category } = item.categories[0];
      const number = (untitledCount.get(item.url) ?? 0) + 1;
      untitledCount.set(item.url, number);
      item.name = `${category} item ${number} (no title given)`;
      item.key = siteKey(vendor.keyPrefix, `${item.slug}|#${item.photos[0].file}`);
      flags.push(`${item.key} has no caption${item.photos[0].alt ? ' (its image has alt text, which is not used)' : ''}, named "${item.name}"`);
    }
    if (item.title && item.title.toLowerCase() === item.categories[0].category.toLowerCase()) flags.push(`${item.key} "${item.name}" only repeats its category`);
    item.era = titleEra(item.name);
    if (item.era && ROUND_CENTURY.test(item.era)) {
      flags.push(`${item.key} "${item.name}": "${item.era}" may mean a century, so no era is kept`);
      item.era = null;
    }
  }
  for (const item of items) {
    const base = items.find((other) => other !== item && other.title && item.title?.startsWith(`${other.title} `));
    if (base) flags.push(`${item.key} "${item.name}" may be another view of "${base.name}"`);
    const files = filesOf(item.photos);
    for (const other of items.filter((candidate) => candidate !== item && sharesPhoto(candidate, files))) flags.push(`${item.key} "${item.name}" shares its photo with ${other.key} "${other.name}"`);
  }
  const result = items.map(({ key, name, price, categories, era, url }) => ({
    key,
    vendor: vendor.id,
    catalog: catalog.id,
    name,
    description: null,
    categories: categories.map((entry) => entry.category),
    era,
    decades: eraDecades(era),
    url,
    ...(price ? { listedPrice: price } : {}),
  }));
  const images = new Map(items.map((item) => [item.key, { urls: item.photos.map((photo) => photo.url) }]));
  const counts = { pages: pages.length, photos: photoCount, items: result.length };
  const report = [
    `Pages: ${counts.pages}; photos: ${counts.photos}; items: ${counts.items} (photos with the same caption on a page are one item, and so are the same caption and photo on two pages, and an untitled photo a captioned item also shows)`,
    ...pageInfo.map(({ page, category, photos, other }) => `  ${page.label} → ${category} (${page.url}): ${photos.length} photos, ${photos.filter((photo) => photo.caption).length} captioned, ${untitledCount.get(page.url) ?? 0} untitled items${other.images ? `, ${other.images} images outside galleries` : ''}${other.paragraphs ? `, ${other.paragraphs} text paragraphs` : ''}`),
    `Photo variant used: ${[...variants].map(([variant, count]) => `${variant} ${count}`).join(', ') || 'none'}`,
    `Prices kept as listedPrice (never shown): ${result.filter((item) => item.listedPrice).length}`,
    `Items with an era in their caption: ${result.filter((item) => item.era).length}`,
    ...(flags.length ? ['Flags:', ...flags.map((flag) => `  ${flag}`)] : ['Flags: none']),
    'Merged (one item from several photos, by page and photo count):',
    ...items.filter((item) => item.sources.reduce((sum, source) => sum + source.photos, 0) > 1).map((item) => `  ${item.key} "${item.name}": ${item.sources.map((source) => `${source.photos} on ${source.category}${source.untitled ? ' (untitled there)' : ''}`).join(', ')}`),
    'Items (key · name · categories · era · listed price · photos):',
    ...result.map((item) => `  ${item.key} · ${item.name} · ${item.categories.join(', ')} · ${item.era ?? 'no era'} · ${item.listedPrice ?? 'no price'} · ${images.get(item.key).urls.length}`),
  ];
  return { items: result, images, counts, report };
}

// Folds another page's photos into an item: its category joins in menu order, and its photos join unless already held.
function merge(item, { category, order, url, photos, untitled = false }) {
  if (!item.categories.some((entry) => entry.category === category)) {
    item.categories.push({ category, order });
    item.categories.sort((a, b) => a.order - b.order);
  }
  for (const photo of photos) if (!item.photos.some((kept) => sameFile(kept.file) === sameFile(photo.file))) item.photos.push(photo);
  item.sources.push({ url, category, photos: photos.length, untitled });
}
