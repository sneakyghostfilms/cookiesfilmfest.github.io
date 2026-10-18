import { DEMO_URL, demoCatalogHref } from '../../scripts/props/demo-links.mjs';
import { displayEra } from '../../scripts/props/normalize.mjs';
import { kindOf } from './props-kinds.js';
import { compareByName } from './props-search.js';

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

// The text of /props/cards.json, which the page loads and draws its cards from (through props-card-text.js). Each
// vendor and catalog is listed once and each item points at its catalog; items are in the page's alphabetical order,
// each with its inventory position for the ranking's ties. An item stores only what its card can't rebuild: the
// citation is rebuilt, the link is stored only when the demo gives it a local PDF, and the kind (kinds.json) only when a
// category overrides its vendor's. The same inputs always give the same text, which the page hashes for the file's ?v=.
export function cardsFile({ items, vendors, kinds, tags = {}, demo = null }) {
  const catalogs = new Map(vendors.flatMap((vendor) => vendor.catalogs.map((catalog) => [catalog.id, { catalog, vendor }])));
  const vendorIds = [...new Set(items.map((item) => item.vendor))];
  const catalogIds = [...new Set(items.map((item) => item.catalog))];
  const catalogTable = catalogIds.map((id) => {
    const { catalog, vendor } = catalogs.get(id);
    const website = catalog.type !== 'pdf';
    return { id, vendor: vendorIds.indexOf(vendor.id), website, linkLabel: website ? catalog.itemLinkLabel : 'Open catalog on Google Drive', ...(website ? {} : { link: catalog.sourceUrl }) };
  });
  const entries = items.map((item, order) => ({ ...item, order })).sort(compareByName).map((item) => {
    const { catalog, vendor } = catalogs.get(item.catalog);
    const card = cardFor(item, { vendor, catalog, tags: tags[item.key] ?? [], demoEntry: demo?.items?.[item.key] ?? null });
    const { website, link } = catalogTable[catalogIds.indexOf(item.catalog)];
    const ownLink = website ? card.link.href !== item.url : card.link.href !== link;
    const kind = kindOf(item, kinds);
    return {
      key: card.key,
      catalog: catalogIds.indexOf(item.catalog),
      name: card.name,
      ...(card.ids ? { ids: card.ids } : {}),
      ...(card.era ? { era: card.era } : {}),
      ...(card.pages ? { pages: card.pages } : {}),
      categories: card.categories,
      ...(card.decades.length ? { decades: card.decades } : {}),
      ...(card.tags.length ? { tags: card.tags } : {}),
      ...(website ? { url: item.url } : {}),
      ...(ownLink ? { link: card.link } : {}),
      ...(card.thumb ? { thumb: card.thumb, alt: card.alt } : {}),
      ...(kind !== kinds.vendors[item.vendor].kind ? { kind } : {}),
      order: item.order,
    };
  });
  const vendorTable = vendorIds.map((id) => {
    const { vendor } = [...catalogs.values()].find((entry) => entry.vendor.id === id);
    return { id, name: vendor.name, inquire: inquiryHref(vendor.contact), kind: kinds.vendors[id].kind };
  });
  return JSON.stringify({ schemaVersion: 1, vendors: vendorTable, catalogs: catalogTable, items: entries });
}

export function telHref(phone) {
  const digits = phone.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '').replace(/\D/g, '');
  return `tel:+${digits.length === 11 && digits.startsWith('1') ? digits : `1${digits}`}`;
}

export function catalogLines(vendor, { indexed = {}, itemCounts = new Map() } = {}) {
  if (!vendor.catalogs.length) return [{ text: 'Inventory not indexed; contact the vendor.' }];
  return vendor.catalogs.flatMap((catalog) => {
    const entry = indexed[catalog.id] ?? {};
    const indexedAt = entry.indexedAt ? ` · indexed ${entry.indexedAt}` : '';
    if (catalog.type === 'pdf') {
      return { text: `${catalog.title} (version ${catalog.version}, ${catalog.pageCount} pages)${indexedAt} · `, href: catalog.sourceUrl, linkLabel: 'Open catalog on Google Drive' };
    }
    const count = itemCounts.get(catalog.id) ?? 0;
    const captured = entry.capturedAt ? ` · captured ${entry.capturedAt}` : '';
    const line = { text: `${catalog.title}${captured} · ${count} ${count === 1 ? 'item' : 'items'}${indexedAt} · `, href: catalog.siteUrl, linkLabel: 'Open site' };
    if (!catalog.unindexedPages?.length) return [line];
    return [line, { text: 'Also on their site, not indexed: ', links: catalog.unindexedPages.map((page) => ({ href: page.url, label: page.label })) }];
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

export function vendorSearchDoc(vendor, order) {
  return { key: vendor.id, name: vendor.name, description: vendor.specialties?.values.join(' ') ?? '', categories: [], tags: [], decades: [], order };
}

const quoted = (texts) => texts.map((text) => `“${text}”`).join(', ');

function placeText(address) {
  const region = [address.state, address.zip].filter(Boolean).join(' ');
  return [address.street, address.city, region].filter(Boolean).join(', ');
}

// A vendor's published facts in the groups its row shows: the notice and its own words, quoted; the address, mailing
// address and hours lines; the terms line; and the inquiry hint. vendorFacts gives the same lines, labelled, in one list.
export function vendorFactGroups(vendor) {
  return {
    notice: vendor.notice ? quoted([vendor.notice.text]) : null,
    words: vendor.specialties ? quoted(vendor.specialties.values) : null,
    where: [
      vendor.address && `Address${vendor.address.label ? ` (${vendor.address.label})` : ''}: ${placeText(vendor.address)}`,
      vendor.mailingAddress && `Mailing address: ${placeText(vendor.mailingAddress)}`,
      vendor.hours && `Hours: ${vendor.hours.text}`,
    ].filter(Boolean),
    terms: vendor.terms ? `Terms they publish: “${vendor.terms.text}”` : 'Pricing and terms: ask the vendor',
    hint: vendor.inquiryHint ? vendor.inquiryHint.text : null,
  };
}

export function specialtiesLine(vendor) {
  const { words } = vendorFactGroups(vendor);
  return words === null ? null : `In their words: ${words}`;
}

export function vendorFacts(vendor) {
  const { notice, where, terms, hint } = vendorFactGroups(vendor);
  return [notice === null ? null : `Notice on their site: ${notice}`, specialtiesLine(vendor), ...where, terms, hint].filter((line) => line !== null);
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
