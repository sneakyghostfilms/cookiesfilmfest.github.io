// The four source kinds, in the order the page lists them. An item's kind is our label from kinds.json, like the source
// type on a vendor box, and never search text: search can filter on it but never matches it.
export const KINDS = [
  { id: 'film-prop', label: 'Film prop' },
  { id: 'set-dressing', label: 'Set dressing' },
  { id: 'event-rental', label: 'Event rental' },
  { id: 'antique', label: 'Antiques and reuse' },
];

export const KIND_LABELS = Object.fromEntries(KINDS.map(({ id, label }) => [id, label]));

// An item's kind: the override of its first category that has one, or else its vendor's kind.
export function kindOf(item, kinds) {
  const vendor = kinds.vendors[item.vendor];
  if (!vendor) throw new Error(`kinds.json has no entry for ${item.vendor}`);
  const overridden = item.categories.find((category) => vendor.categories?.[category]);
  return overridden ? vendor.categories[overridden].kind : vendor.kind;
}
