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

export function parseGalleries(pages, { vendor, catalog }) {
  const flags = [];
  const pageLines = [];
  const variants = new Map();
  const items = [];
  let photoCount = 0;
  for (const page of pages) {
    const { heading, title } = categoryOf(page.html);
    const category = heading || title;
    if (!category) throw new Error(`${page.url} has neither a heading nor a title; stopping before the inventory is written.`);
    const photos = photosOf(page.html, page.url);
    if (!heading) flags.push(`${page.url} has no banner heading, so its <title> "${title}" is the category`);
    else if (title && title !== heading) flags.push(`${page.url}: heading "${heading}", <title> "${title}"; the heading is the category`);
    if (page.label !== category) flags.push(`${page.url}: menu label "${page.label}", category "${category}"`);
    photoCount += photos.length;
    const other = otherContent(page.html);
    const groups = [];
    for (const photo of photos) {
      tally(variants, photo.variant);
      if (photo.shown !== null && photo.shown !== photo.caption) flags.push(`${page.url}: a photo's printed caption "${photo.shown}" differs from its title "${photo.caption}"; the title is used`);
      if (ANY_PRICE.test(photo.caption) && !EACH_PRICE.test(photo.caption)) {
        throw new Error(`A caption on ${page.url} gives a price in a form this import doesn't read: "${photo.caption}"; stopping before the inventory is written.`);
      }
      const price = photo.caption.match(EACH_PRICE)?.[1] ?? null;
      const name = price ? photo.caption.replace(EACH_PRICE, '') : photo.caption;
      const same = groups.find((group) => (name ? group.name === name : !group.name && group.photos[0].file === photo.file));
      if (same) same.photos.push(photo);
      else groups.push({ name, price, photos: [photo] });
    }
    let untitled = 0;
    for (const group of groups) {
      const files = new Set(group.photos.map((photo) => photo.file));
      const earlier = items.find((item) => item.title === group.name && item.photos.some((photo) => files.has(photo.file)));
      if (earlier) {
        if (!earlier.categories.includes(category)) earlier.categories.push(category);
        for (const photo of group.photos) if (!earlier.photos.some((kept) => kept.file === photo.file)) earlier.photos.push(photo);
        earlier.sources.push({ category, photos: group.photos.length });
        if (earlier.price !== group.price) flags.push(`${earlier.key}: listed again on ${page.url} with another price; the first is kept`);
        flags.push(`${earlier.key} "${earlier.name}" is also on ${page.url} with the same photo: one item, categories ${earlier.categories.join(', ')}`);
        continue;
      }
      let name = group.name;
      let key = siteKey(vendor.keyPrefix, `${page.slug}|${name}`);
      if (!name) {
        untitled += 1;
        name = `${category} item ${untitled} (no title given)`;
        key = siteKey(vendor.keyPrefix, `${page.slug}|#${group.photos[0].file}`);
        flags.push(`${key} has no caption${group.photos[0].alt ? ' (its image has alt text, which is not used)' : ''}, named "${name}"`);
      } else if (name.toLowerCase() === category.toLowerCase()) {
        flags.push(`${key} "${name}" only repeats its category`);
      }
      let era = titleEra(name);
      if (era && ROUND_CENTURY.test(era)) {
        flags.push(`${key} "${name}": "${era}" may mean a century, so no era is kept`);
        era = null;
      }
      items.push({ key, title: group.name, name, price: group.price, categories: [category], era, url: page.url, photos: group.photos, sources: [{ category, photos: group.photos.length }] });
    }
    pageLines.push(`  ${page.label} → ${category} (${page.url}): ${photos.length} photos, ${photos.filter((photo) => photo.caption).length} captioned, ${untitled} untitled items${other.images ? `, ${other.images} images outside galleries` : ''}${other.paragraphs ? `, ${other.paragraphs} text paragraphs` : ''}`);
  }
  for (const item of items) {
    const base = items.find((other) => other !== item && other.title && item.title?.startsWith(`${other.title} `));
    if (base) flags.push(`${item.key} "${item.name}" may be another view of "${base.name}"`);
  }
  const result = items.map(({ key, name, price, categories, era, url }) => ({
    key,
    vendor: vendor.id,
    catalog: catalog.id,
    name,
    description: null,
    categories,
    era,
    decades: eraDecades(era),
    url,
    ...(price ? { listedPrice: price } : {}),
  }));
  const images = new Map(items.map((item) => [item.key, { urls: item.photos.map((photo) => photo.url) }]));
  const counts = { pages: pages.length, photos: photoCount, items: result.length };
  const report = [
    `Pages: ${counts.pages}; photos: ${counts.photos}; items: ${counts.items} (photos with the same caption on a page are one item, and so are the same caption and photo on two pages)`,
    ...pageLines,
    `Photo variant used: ${[...variants].map(([variant, count]) => `${variant} ${count}`).join(', ') || 'none'}`,
    `Prices kept as listedPrice (never shown): ${result.filter((item) => item.listedPrice).length}`,
    `Items with an era in their caption: ${result.filter((item) => item.era).length}`,
    ...(flags.length ? ['Flags:', ...flags.map((flag) => `  ${flag}`)] : ['Flags: none']),
    'Merged (one item from several photos, by page and photo count):',
    ...(items.filter((item) => item.sources.reduce((sum, source) => sum + source.photos, 0) > 1).map((item) => `  ${item.key} "${item.name}": ${item.sources.map((source) => `${source.photos} on ${source.category}`).join(', ')}`)),
    'Items (key · name · categories · era · listed price · photos):',
    ...result.map((item) => `  ${item.key} · ${item.name} · ${item.categories.join(', ')} · ${item.era ?? 'no era'} · ${item.listedPrice ?? 'no price'} · ${images.get(item.key).urls.length}`),
  ];
  return { items: result, images, counts, report };
}
