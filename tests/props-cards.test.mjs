import assert from 'node:assert/strict';
import test from 'node:test';
import { affiliation, cardFor, contactRoutes, inquiryHref, privateFacts, socialLinks, vendorFacts, vendorSources } from '../src/scripts/props-cards.js';

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

test('the affiliation line names every vendor', () => {
  assert.equal(affiliation([pdfVendor]), 'Not affiliated with Steel City Props.');
  assert.equal(affiliation([pdfVendor, siteVendor]), 'Not affiliated with Steel City Props or Dezzign Central.');
  assert.equal(affiliation([pdfVendor, siteVendor, { name: 'Retro on 8th' }]), 'Not affiliated with Steel City Props, Dezzign Central, or Retro on 8th.');
});

test('contact routes and facts come only from what the vendor publishes', () => {
  assert.deepEqual(contactRoutes(siteVendor.contact), [
    { label: 'warehouse@example.com', href: 'mailto:warehouse@example.com' },
    { label: '412.555.0100', href: 'tel:+14125550100' },
    { label: 'contact page', href: 'https://vendor.example/contact/', external: true },
  ]);
  assert.equal(inquiryHref({ formUrl: null, pageUrl: null, email: 'a@example.com' }), 'mailto:a@example.com');
  assert.deepEqual(vendorFacts(siteVendor), [
    'Prop house. Offers: by inquiry',
    'Address (prop warehouse): 1 test street, pittsburgh, pa 15201',
    'Mailing address: p.o. box 1, pittsburgh, pa 15235',
    'Hours: please call or email us to schedule an appointment',
    'No prices or terms are published; ask when you inquire.',
  ]);
  const quiet = { ...siteVendor, sourceType: null, modes: null, address: null, mailingAddress: null, hours: null };
  assert.deepEqual(vendorFacts(quiet), ['No prices or terms are published; ask when you inquire.'], 'nothing is filled in by inference');
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
