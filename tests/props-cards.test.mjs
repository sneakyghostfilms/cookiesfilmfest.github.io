import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOT_AFFILIATED, cardFor, catalogLines, contactRoutes, inquiryHref, privateFacts, socialLinks, specialtiesLine, telHref, vendorBadges, vendorFacts, vendorSources,
} from '../src/scripts/props-cards.js';

const pdfVendor = { id: 'steel-city-props', name: 'Steel City Props', contact: { formUrl: 'https://forms.example/form', email: 'shop@example.com', phone: null, pageUrl: null } };
const pdfCatalog = { id: 'scp-2026-09-30', type: 'pdf', sourceUrl: 'https://drive.example/catalog' };
const siteVendor = {
  id: 'dezzign-central',
  name: 'Dezzign Central',
  contact: { formUrl: null, email: 'warehouse@example.com', phone: '412.555.0100', pageUrl: 'https://vendor.example/contact/', source: 'https://vendor.example/contact/' },
  sourceType: { value: 'prop-house', source: 'https://vendor.example/ (page title)' },
  address: { label: 'prop warehouse', street: '1 test street', city: 'pittsburgh', state: 'pa', zip: '15201', source: 'https://vendor.example/contact/' },
  mailingAddress: { label: null, street: 'p.o. box 1', city: 'pittsburgh', state: 'pa', zip: '15235', source: 'https://vendor.example/contact/' },
  hours: { text: 'please call or email us to schedule an appointment', source: 'https://vendor.example/contact/' },
  modes: { values: ['inquire'], source: 'https://vendor.example/props/chairs/' },
  terms: null,
  social: null,
  inquiryHint: null,
};
const siteCatalog = { id: 'dz-2026-10-17', type: 'wordpress-pages', siteUrl: 'https://vendor.example/props/', itemLinkLabel: 'Open vendor page' };
const pdfItem = { key: 'scp-056', vendor: pdfVendor.id, catalog: pdfCatalog.id, itemNumbers: ['056'], printedIds: ['[056]'], name: 'GREEN CHANGE MACHINE', description: 'GREEN CHANGE MACHINE 1960S', categories: ['THE OFFICE'], era: '1960S', decades: [1960], pages: [5] };
const siteItem = { key: 'dz-1nfqu2', vendor: siteVendor.id, catalog: siteCatalog.id, name: 'stainless steel refrigerator', description: null, categories: ['refrigerators'], era: 'era 1950', decades: [1950], url: 'https://vendor.example/props/refrigerators/' };
const pricedItem = { ...siteItem, key: 'ro8-23kj0f', url: 'https://shop.example/products/test-typewriter', name: 'Test Typewriter', era: null, decades: [], listedPrice: '145.00' };

test('a catalog card keeps the spec line: vendor, item numbers, caption, era and page', () => {
  const card = cardFor(pdfItem, { vendor: pdfVendor, catalog: pdfCatalog, tags: ['coin changer'] });
  assert.deepEqual([card.vendorName, card.ids, card.name, card.era, card.pages], ['Steel City Props', '#056', 'GREEN CHANGE MACHINE', '1960s', 'page 5']);
  assert.deepEqual(card.link, { href: 'https://drive.example/catalog', label: 'Open catalog on Google Drive' });
  assert.equal(card.inquire, 'https://forms.example/form');
  assert.equal(card.cite, 'When you inquire, cite #056 · GREEN CHANGE MACHINE · page 5');
  assert.equal(card.thumb, null);
  const demo = cardFor(pdfItem, { vendor: pdfVendor, catalog: pdfCatalog, demoEntry: { catalog: pdfCatalog.id, page: 5, box: { left: 14, top: 841, right: 154, bottom: 700 }, thumb: { width: 320, height: 300 } } });
  assert.equal(demo.link.label, 'Open catalog (local PDF)');
  assert.equal(demo.photoCredit, 'Photo: Steel City Props catalog');
});

test('a website card has no item number or page and links to the vendor page', () => {
  const card = cardFor(siteItem, { vendor: siteVendor, catalog: siteCatalog });
  assert.deepEqual([card.ids, card.pages, card.era], [null, null, 'era 1950']);
  assert.deepEqual(card.link, { href: 'https://vendor.example/props/refrigerators/', label: 'Open vendor page' });
  assert.equal(card.inquire, 'https://vendor.example/contact/', 'the contact page when there is no form');
  assert.equal(card.cite, 'When you inquire, cite “stainless steel refrigerator” and its page link');
  assert.equal(card.alt, 'stainless steel refrigerator');
  const demo = cardFor(siteItem, { vendor: siteVendor, catalog: siteCatalog, demoEntry: { catalog: siteCatalog.id, thumb: { width: 320, height: 240 }, image: 'https://vendor.example/a.jpg' } });
  assert.equal(demo.link.href, 'https://vendor.example/props/refrigerators/', 'a website item never links to a local PDF');
  assert.equal(demo.photoCredit, 'Photo: Dezzign Central website');
});

test('a listed price is stored but never shown', () => {
  const card = cardFor(pricedItem, { vendor: siteVendor, catalog: { ...siteCatalog, itemLinkLabel: 'Open product page' } });
  assert.doesNotMatch(JSON.stringify(card), /145/);
});

test('the affiliation line covers every vendor listed, however many there are', () => {
  assert.equal(NOT_AFFILIATED, 'Not affiliated with any vendor listed here.');
});

test('badges show the source type and modes, and a regional badge outside Pennsylvania', () => {
  assert.deepEqual(vendorBadges(siteVendor), [{ text: 'Prop house' }, { text: 'By inquiry' }]);
  const cleveland = { ...siteVendor, modes: { values: ['rent', 'sale'] }, address: { city: 'Cleveland', state: 'OH' } };
  assert.deepEqual(vendorBadges(cleveland), [{ text: 'Prop house' }, { text: 'Rentals' }, { text: 'Sales' }, { text: 'Regional: Cleveland, OH', regional: true }]);
  for (const state of ['PA', 'pa', 'Pennsylvania', ' PA ']) {
    assert.ok(!vendorBadges({ ...siteVendor, address: { city: 'Pittsburgh', state } }).some((badge) => badge.regional), state);
  }
  assert.deepEqual(vendorBadges({ ...siteVendor, sourceType: null, modes: null, address: null }), [], 'nothing is filled in by inference');
});

test('a phone published with an extension dials the main number', () => {
  for (const phone of ['(216) 862-5445 x4', '(216) 862-5445 ext. 4', '216-862-5445 x 6']) assert.equal(telHref(phone), 'tel:+12168625445', phone);
});

test('notices and specialties are quoted as the vendor wrote them', () => {
  const vendor = { ...siteVendor, notice: { text: 'We have moved!', source: 'https://vendor.example/' }, specialties: { values: ['Typewriters', 'Period and Modern Props'], source: 'https://vendor.example/' } };
  assert.equal(specialtiesLine(vendor), 'In their words: “Typewriters”, “Period and Modern Props”');
  assert.deepEqual(vendorFacts(vendor).slice(0, 2), ['Notice on their site: “We have moved!”', 'In their words: “Typewriters”, “Period and Modern Props”']);
  assert.equal(specialtiesLine(siteVendor), null);
});

test('contact routes and facts come only from what the vendor publishes', () => {
  assert.deepEqual(contactRoutes(siteVendor.contact), [
    { label: 'warehouse@example.com', href: 'mailto:warehouse@example.com' },
    { label: '412.555.0100', href: 'tel:+14125550100' },
    { label: 'contact page', href: 'https://vendor.example/contact/', external: true },
  ]);
  assert.equal(inquiryHref({ formUrl: null, pageUrl: null, email: 'a@example.com' }), 'mailto:a@example.com');
  assert.deepEqual(vendorFacts(siteVendor), [
    'Address (prop warehouse): 1 test street, pittsburgh, pa 15201',
    'Mailing address: p.o. box 1, pittsburgh, pa 15235',
    'Hours: please call or email us to schedule an appointment',
    'Pricing and terms: ask the vendor',
  ]);
  const quiet = { ...siteVendor, sourceType: null, modes: null, address: null, mailingAddress: null, hours: null };
  assert.deepEqual(vendorFacts(quiet), ['Pricing and terms: ask the vendor'], 'nothing is filled in by inference');
  for (const phone of ['412.555.0100', '1-412-555-0100', '+1 412 555 0100', '(412) 555-0100']) {
    assert.equal(contactRoutes({ phone }).at(0).href, 'tel:+14125550100', phone);
  }
  assert.deepEqual(socialLinks(null), []);
  assert.deepEqual(socialLinks({ instagram: 'https://instagram.example/v', facebook: null, linktree: 'https://linktree.example/v' }).map((link) => link.label), ['Instagram', 'Linktree']);
});

test('sources are listed once each, links shortened and notes trimmed', () => {
  const vendor = { ...siteVendor, terms: { text: 'x', source: 'catalog page 3 ("Terms"); https://vendor.example/contact/' } };
  assert.deepEqual(vendorSources(vendor), [
    { href: 'https://vendor.example/', label: 'vendor.example' },
    { href: 'https://vendor.example/contact/', label: 'vendor.example/contact' },
    { href: 'https://vendor.example/props/chairs/', label: 'vendor.example/props/chairs' },
    { label: 'catalog page 3' },
  ]);
});

test('private relationship notes are rendered only from the private file', () => {
  assert.deepEqual(privateFacts(undefined), []);
  assert.deepEqual(privateFacts({ permissions: { listing: 'not-asked', photos: 'asked', asOf: '2026-10-17' }, notes: 'Met at the market.' }), [
    'Listing permission: not asked; photo permission: asked (as of 2026-10-17)',
    'Notes: Met at the market.',
  ]);
});

test('catalog lines describe each snapshot, and a vendor with none says so', () => {
  assert.deepEqual(catalogLines({ ...siteVendor, catalogs: [] }), [{ text: 'Inventory not indexed; contact the vendor.' }]);
  const indexed = { [siteCatalog.id]: { indexedAt: '2026-10-17', capturedAt: '2026-10-17' }, [pdfCatalog.id]: { indexedAt: '2026-10-17' } };
  const itemCounts = new Map([[siteCatalog.id, 23]]);
  assert.deepEqual(catalogLines({ ...siteVendor, catalogs: [{ ...siteCatalog, title: 'Prop pages' }] }, { indexed, itemCounts }), [
    { text: 'Prop pages · captured 2026-10-17 · 23 items · indexed 2026-10-17 · ', href: 'https://vendor.example/props/', linkLabel: 'Open site' },
  ]);
  assert.deepEqual(catalogLines({ ...pdfVendor, catalogs: [{ ...pdfCatalog, title: 'Rental Catalog', version: '2026-09-30', pageCount: 49 }] }, { indexed }), [
    { text: 'Rental Catalog (version 2026-09-30, 49 pages) · indexed 2026-10-17 · ', href: 'https://drive.example/catalog', linkLabel: 'Open catalog on Google Drive' },
  ]);
});
