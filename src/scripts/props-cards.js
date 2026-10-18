import { DEMO_URL, demoCatalogHref } from '../../scripts/props/demo-links.mjs';
import { displayEra } from '../../scripts/props/normalize.mjs';

const MODE_LABELS = { rent: 'Rentals', sale: 'Sales', inquire: 'By inquiry' };
const HOME_STATE = /^(pa|pennsylvania)$/i;
export const NOT_AFFILIATED = 'Not affiliated with any vendor listed here.';
const SOURCE_TYPE_LABELS = {
  'prop-house': 'Prop house',
  'vintage-rental': 'Vintage rental',
  'event-rental': 'Event rental',
  'antique-reuse': 'Antiques and reuse',
  'theater-stock': 'Theater stock',
  specialty: 'Specialty',
};

function idsLabel(itemNumbers) {
  return itemNumbers.length ? itemNumbers.map((number) => `#${number}`).join(' / ') : 'no item number printed';
}

function pagesLabel(pages) {
  return pages.length > 1 ? `pages ${pages.join(', ')}` : `page ${pages[0]}`;
}

export function inquiryHref(contact) {
  return contact.formUrl ?? contact.pageUrl ?? (contact.email ? `mailto:${contact.email}` : null);
}

export function cardFor(item, { vendor, catalog, tags = [], demoEntry = null }) {
  const website = typeof item.url === 'string';
  const ids = website ? null : idsLabel(item.itemNumbers);
  const pages = website ? null : pagesLabel(item.pages);
  let link;
  if (website) link = { href: item.url, label: catalog.itemLinkLabel };
  else if (demoEntry?.page) link = { href: demoCatalogHref(demoEntry), label: 'Open catalog (local PDF)' };
  else link = { href: catalog.sourceUrl, label: 'Open catalog on Google Drive' };
  const thumb = demoEntry?.thumb ? { src: `${DEMO_URL}/thumbs/${item.key}.webp`, ...demoEntry.thumb } : null;
  return {
    key: item.key,
    vendorId: vendor.id,
    vendorName: vendor.name,
    ids,
    name: item.name,
    era: item.era ? displayEra(item.era) : null,
    pages,
    categories: item.categories,
    decades: item.decades,
    tags,
    link,
    inquire: inquiryHref(vendor.contact),
    cite: website ? `When you inquire, cite “${item.name}” and its page link` : `When you inquire, cite ${ids} · ${item.name} · ${pages}`,
    thumb,
    alt: item.description ?? item.name,
    photoCredit: thumb ? `Photo: ${vendor.name} ${website ? 'website' : 'catalog'}` : null,
  };
}

export function telHref(phone) {
  const digits = phone.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '').replace(/\D/g, '');
  return `tel:+${digits.length === 11 && digits.startsWith('1') ? digits : `1${digits}`}`;
}

export function catalogLines(vendor, { indexed = {}, itemCounts = new Map() } = {}) {
  if (!vendor.catalogs.length) return [{ text: 'Inventory not indexed; contact the vendor.' }];
  return vendor.catalogs.map((catalog) => {
    const entry = indexed[catalog.id] ?? {};
    const indexedAt = entry.indexedAt ? ` · indexed ${entry.indexedAt}` : '';
    if (catalog.type === 'pdf') {
      return { text: `${catalog.title} (version ${catalog.version}, ${catalog.pageCount} pages)${indexedAt} · `, href: catalog.sourceUrl, linkLabel: 'Open catalog on Google Drive' };
    }
    const count = itemCounts.get(catalog.id) ?? 0;
    const captured = entry.capturedAt ? ` · captured ${entry.capturedAt}` : '';
    return { text: `${catalog.title}${captured} · ${count} ${count === 1 ? 'item' : 'items'}${indexedAt} · `, href: catalog.siteUrl, linkLabel: 'Open site' };
  });
}

export function contactRoutes(contact) {
  return [
    contact.formUrl && { label: 'official contact form', href: contact.formUrl, external: true },
    contact.email && { label: contact.email, href: `mailto:${contact.email}` },
    contact.phone && { label: contact.phone, href: telHref(contact.phone) },
    contact.pageUrl && { label: 'contact page', href: contact.pageUrl, external: true },
  ].filter(Boolean);
}

export function socialLinks(social) {
  if (!social) return [];
  return [
    social.instagram && { label: 'Instagram', href: social.instagram },
    social.facebook && { label: 'Facebook', href: social.facebook },
    social.linktree && { label: 'Linktree', href: social.linktree },
  ].filter(Boolean);
}

export function vendorBadges(vendor) {
  const badges = [];
  if (vendor.sourceType) badges.push({ text: SOURCE_TYPE_LABELS[vendor.sourceType.value] });
  for (const mode of vendor.modes?.values ?? []) badges.push({ text: MODE_LABELS[mode] });
  const state = vendor.address?.state?.trim();
  if (state && !HOME_STATE.test(state)) badges.push({ text: `Regional: ${[vendor.address.city, state].filter(Boolean).join(', ')}`, regional: true });
  return badges;
}

const quoted = (texts) => texts.map((text) => `“${text}”`).join(', ');

export function specialtiesLine(vendor) {
  return vendor.specialties ? `In their words: ${quoted(vendor.specialties.values)}` : null;
}

function placeText(address) {
  const region = [address.state, address.zip].filter(Boolean).join(' ');
  return [address.street, address.city, region].filter(Boolean).join(', ');
}

export function vendorFacts(vendor) {
  const lines = [];
  if (vendor.notice) lines.push(`Notice on their site: ${quoted([vendor.notice.text])}`);
  if (vendor.specialties) lines.push(specialtiesLine(vendor));
  if (vendor.address) lines.push(`Address${vendor.address.label ? ` (${vendor.address.label})` : ''}: ${placeText(vendor.address)}`);
  if (vendor.mailingAddress) lines.push(`Mailing address: ${placeText(vendor.mailingAddress)}`);
  if (vendor.hours) lines.push(`Hours: ${vendor.hours.text}`);
  lines.push(vendor.terms ? `Terms they publish: “${vendor.terms.text}”` : 'Pricing and terms: ask the vendor');
  if (vendor.inquiryHint) lines.push(vendor.inquiryHint.text);
  return lines;
}

const FACT_FIELDS = ['sourceType', 'address', 'mailingAddress', 'hours', 'modes', 'terms', 'contact', 'social', 'inquiryHint', 'specialties', 'notice'];

export function vendorSources(vendor) {
  const sources = [];
  for (const field of FACT_FIELDS) {
    const source = vendor[field]?.source;
    if (!source) continue;
    for (const part of source.split(/;\s*/)) {
      const url = part.match(/https?:\/\/[^\s)]+/)?.[0];
      const entry = url ? { href: url, label: url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') } : { label: part.replace(/\s*\(.*\)\s*$/, '').trim() };
      if (!sources.some((existing) => existing.label === entry.label)) sources.push(entry);
    }
  }
  return sources;
}

export function privateFacts(info) {
  if (!info) return [];
  const lines = [];
  const status = (value) => String(value).replace(/-/g, ' ');
  if (info.permissions) lines.push(`Listing permission: ${status(info.permissions.listing)}; photo permission: ${status(info.permissions.photos)} (as of ${info.permissions.asOf})`);
  if (info.notes) lines.push(`Notes: ${info.notes}`);
  return lines;
}
