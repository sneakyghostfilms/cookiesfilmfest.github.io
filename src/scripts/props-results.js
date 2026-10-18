import { search } from './props-search.js';

// The keyword page's view of its search results: which filter values they hold, and the order its cards are drawn in.

const VALUES = {
  category: (doc) => doc.categories,
  vendor: (doc) => [doc.vendor],
  kind: (doc) => [doc.kind],
  decade: (doc) => doc.decades.map(String),
};

// Each filter's values found in the results of the query under every other filter, so a filter that is set still
// offers the values it could switch to. A filter that isn't set sees the search's own results.
export function filterValues(index, query, filters, results) {
  return Object.fromEntries(Object.entries(VALUES).map(([name, valuesOf]) => {
    const seen = filters[name] ? search(index, query, { ...filters, [name]: '' }) : results;
    return [name, new Set(seen.flatMap(valuesOf))];
  }));
}

// The cards with a photo first, each group in the ranking's order. Only the local demo has photos.
export function photosFirst(docs) {
  return [...docs.filter((doc) => doc.card.thumb), ...docs.filter((doc) => !doc.card.thumb)];
}

