import { eraDecades } from '../normalize.mjs';
import { siteKey } from '../site-items.mjs';
import { attribute, decodeEntities } from './html-text.mjs';

const ERA_SUFFIX = /^(.*\S)\s+-\s+(era\s+\d{4}s?)$/i;
const GENERIC_WORDS = new Set(['image', 'img', 'photo', 'picture', 'pic', 'untitled']);

export function isDescriptive(alt) {
  const text = alt.trim();
  if (!/\p{L}/u.test(text)) return false;
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(text)) return false;
  if (/^(img|dsc|dscn|image|photo|pic)[\s_-]?\d+$/i.test(text)) return false;
  return !GENERIC_WORDS.has(text.toLowerCase());
}

export function splitAltEra(alt) {
  const match = alt.match(ERA_SUFFIX);
  return match ? { name: match[1], era: match[2] } : { name: alt, era: null };
}

function photosOf(html, link) {
  return [...String(html).matchAll(/<img\b[^>]*>/gi)].map((match, index) => ({
    position: index + 1,
    src: new URL(attribute(match[0], 'src') ?? '', link).href,
    alt: (attribute(match[0], 'alt') ?? '').trim(),
  }));
}

export function parsePages(pages, { vendor, catalog }) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('The props pages response holds no pages.');
  for (const page of pages) {
    if (typeof page?.link !== 'string' || !page.link.startsWith(catalog.siteUrl)) {
      throw new Error(`Page ${page?.id} (${page?.link}) is not under ${catalog.siteUrl}.`);
    }
  }
  const items = [];
  const images = new Map();
  const flags = [];
  let photoCount = 0;
  for (const page of [...pages].sort((a, b) => a.id - b.id)) {
    const category = decodeEntities(page.title.rendered).trim();
    const photos = photosOf(page.content.rendered, page.link);
    photoCount += photos.length;
    const groups = [];
    for (const photo of photos) {
      const titled = isDescriptive(photo.alt);
      const existing = titled && groups.find((group) => group.alt === photo.alt);
      if (existing) existing.photos.push(photo);
      else groups.push({ alt: photo.alt, titled, photos: [photo] });
    }
    let untitled = 0;
    for (const group of groups) {
      let name;
      let era = null;
      let key;
      if (group.titled) {
        ({ name, era } = splitAltEra(group.alt));
        key = siteKey(vendor.keyPrefix, `${page.slug}|${group.alt}`);
        if (group.alt.toLowerCase() === category.toLowerCase()) flags.push(`${key} "${group.alt}" only repeats its category`);
        const base = groups.find((other) => other !== group && other.titled && group.alt.startsWith(`${other.alt} `));
        if (base) flags.push(`${key} "${group.alt}" may be another view of "${base.alt}"`);
      } else {
        untitled += 1;
        name = `${category} item ${untitled} (no title given)`;
        key = siteKey(vendor.keyPrefix, `${page.slug}|#${group.photos[0].position}`);
        flags.push(`${key} has no usable photo title (alt ${JSON.stringify(group.alt)}), named "${name}"`);
      }
      items.push({ key, vendor: vendor.id, catalog: catalog.id, name, description: null, categories: [category], era, decades: eraDecades(era), url: page.link });
      images.set(key, { urls: group.photos.map((photo) => photo.src) });
    }
  }
  const counts = { pages: pages.length, photos: photoCount, items: items.length };
  const report = [
    `Pages: ${counts.pages}; photos: ${counts.photos}; items: ${counts.items} (photos with the same title are one item)`,
    ...pages.slice().sort((a, b) => a.id - b.id).map((page) => `  ${decodeEntities(page.title.rendered).trim()}: ${page.link}`),
    `Items with a stated era: ${items.filter((item) => item.era).map((item) => `${item.key} "${item.name}" ${item.era}`).join('; ') || 'none'}`,
    `Flags: ${flags.length ? `\n  ${flags.join('\n  ')}` : 'none'}`,
  ];
  return { items, images, counts, report };
}
