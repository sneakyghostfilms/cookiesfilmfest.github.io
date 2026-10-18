// The page's view of /props/cards.json: each entry's card fields and its search document. This module runs in the
// browser, so it imports nothing; props-cards.js writes the file on the build side, and a test checks that every card
// here matches the card props-cards.js would draw for the same item.

export function cardText(entry, { vendors, catalogs }) {
  const catalog = catalogs[entry.catalog];
  const vendor = vendors[catalog.vendor];
  const ids = entry.ids ?? null;
  const pages = entry.pages ?? null;
  const thumb = entry.thumb ?? null;
  return {
    key: entry.key,
    vendorId: vendor.id,
    vendorName: vendor.name,
    ids,
    name: entry.name,
    era: entry.era ?? null,
    pages,
    categories: entry.categories,
    decades: entry.decades ?? [],
    tags: entry.tags ?? [],
    kind: entry.kind ?? vendor.kind,
    link: entry.link ?? { href: catalog.website ? entry.url : catalog.link, label: catalog.linkLabel },
    inquire: vendor.inquire,
    cite: catalog.website ? `When you inquire, cite “${entry.name}” and its page link` : `When you inquire, cite ${ids} · ${entry.name} · ${pages}`,
    thumb,
    alt: thumb ? entry.alt : null,
    photoCredit: thumb ? `Photo: ${vendor.name} ${catalog.website ? 'website' : 'catalog'}` : null,
    order: entry.order,
  };
}

// The fields the keyword index reads, and the kind it filters on: the same ones the Worker's searchDocs builds from the
// inventory.
export function searchDocFromCard(card) {
  return {
    key: card.key,
    name: card.name,
    description: [card.name, card.era].filter(Boolean).join(' '),
    categories: card.categories,
    vendor: card.vendorId,
    tags: card.tags,
    decades: card.decades,
    kind: card.kind,
    order: card.order,
  };
}
