import { siteKey } from '../site-items.mjs';
import { attribute, decodeEntities } from './html-text.mjs';

const textOf = (html) => decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function captionsOf(html) {
  const captions = new Map();
  for (const [, attributes, inner] of html.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/gi)) {
    const tag = `<h3${attributes}>`;
    const id = attribute(tag, 'id');
    if (id && /\bcaption-title\b/.test(attribute(tag, 'class') ?? '')) captions.set(id, textOf(inner));
  }
  return captions;
}

function backgroundUrl(tag) {
  return (attribute(tag, 'style') ?? '').match(/background-image:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i)?.[1] ?? null;
}

export function parseCollections(html, { vendor, catalog }) {
  const sections = [...html.matchAll(/data-anchor="([^"]*)"/g)].map((match) => ({ position: match.index, name: decodeEntities(match[1]).trim() }));
  if (!sections.length) throw new Error('The collections page holds no section anchors.');
  const galleries = [...html.matchAll(/data-element-type="dPhotoGalleryId"/g)].map((match) => match.index);
  const captions = captionsOf(html);
  const flags = [];
  const photos = [];
  for (const match of html.matchAll(/<a\b[^>]*\bdata-image-url="[^"]*"[^>]*>/gi)) {
    const tag = match[0];
    const section = sections.filter((entry) => entry.position < match.index).at(-1);
    const image = attribute(tag, 'data-image-url');
    if (!section) {
      flags.push(`a photo before the first section was skipped: ${image}`);
      continue;
    }
    const labelledBy = attribute(tag, 'aria-labelledby');
    if (labelledBy && !captions.has(labelledBy)) flags.push(`${image} names caption ${labelledBy}, which is not on the page`);
    const title = labelledBy ? captions.get(labelledBy) ?? '' : '';
    const photo = backgroundUrl(tag);
    if (!photo) flags.push(`${image} has no published thumbnail URL`);
    else if (!/-640w\.\w+$/.test(new URL(photo, catalog.sourceUrl).pathname)) flags.push(`${image}'s published thumbnail is not a 640w variant`);
    photos.push({ section: section.name, image, photo: photo && new URL(photo, catalog.sourceUrl).href, title });
  }
  for (const [order, section] of sections.entries()) {
    const end = sections[order + 1]?.position ?? Infinity;
    if (!galleries.some((position) => position > section.position && position < end)) flags.push(`section "${section.name}" has no photo gallery`);
  }
  const groups = [];
  for (const photo of photos) {
    const existing = photo.title && groups.find((group) => group.section === photo.section && group.title === photo.title);
    if (existing) existing.photos.push(photo);
    else groups.push({ section: photo.section, title: photo.title, photos: [photo] });
  }
  const untitledCount = new Map();
  const items = [];
  const images = new Map();
  for (const group of groups) {
    let name;
    let key;
    if (group.title) {
      name = group.title;
      key = siteKey(vendor.keyPrefix, `${group.section}|${group.title}`);
    } else {
      const number = (untitledCount.get(group.section) ?? 0) + 1;
      untitledCount.set(group.section, number);
      name = `${group.section} item ${number} (no title given)`;
      key = siteKey(vendor.keyPrefix, `${group.section}|#${group.photos[0].image.split('/').pop()}`);
      flags.push(`${key} has no title, named "${name}"`);
    }
    items.push({ key, vendor: vendor.id, catalog: catalog.id, name, description: null, categories: [group.section], era: null, decades: [], url: catalog.sourceUrl });
    images.set(key, { urls: group.photos.map((photo) => photo.photo).filter(Boolean) });
  }
  const counts = { sections: sections.length, photos: photos.length, items: items.length };
  const report = [
    `Sections: ${counts.sections}; photos: ${counts.photos}; items: ${counts.items} (photos with the same title in a section are one item)`,
    ...sections.map((section) => {
      const inSection = photos.filter((photo) => photo.section === section.name);
      return `  ${section.name}: ${inSection.length} photos, ${inSection.filter((photo) => photo.title).length} titled`;
    }),
    'Items (key · name · section · photos):',
    ...items.map((item) => `  ${item.key} · ${item.name} · ${item.categories[0]} · ${images.get(item.key).urls.length}`),
    `Flags: ${flags.length ? `\n  ${flags.join('\n  ')}` : 'none'}`,
  ];
  return { items, images, counts, report };
}
