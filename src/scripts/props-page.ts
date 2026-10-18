import { searchDocFromCard } from "./props-card-text.js";
import { type Card, loadCards, renderCard } from "./props-card-view.ts";
import { buildIndex, rankText, search } from "./props-search.js";
import { queryFromHash } from "./props-search-link.js";

const PAGE_SIZE = 24;
const formatNumber = (value: number) => value.toLocaleString("en-US");
const LOAD_FAILED = "The item list couldn't load. Reload the page to try again.";
const list = document.getElementById("props-results") as HTMLOListElement;
const query = document.getElementById("props-query") as HTMLInputElement;
const category = document.getElementById("props-category") as HTMLSelectElement;
const decade = document.getElementById("props-decade") as HTMLSelectElement;
const vendor = document.getElementById("props-vendor") as HTMLSelectElement | null;
const kind = document.getElementById("props-kind") as HTMLSelectElement;
const count = document.getElementById("props-count") as HTMLElement;
const empty = document.getElementById("props-empty") as HTMLElement;
const more = document.getElementById("props-more") as HTMLButtonElement;
const form = document.getElementById("props-form") as HTMLFormElement;

type Doc = ReturnType<typeof searchDocFromCard> & { card: Card };
let docs: Doc[] = [];
let index: ReturnType<typeof buildIndex> | null = null;
let results: Doc[] = [];
let shown = PAGE_SIZE;
const vendorMatches = document.getElementById("props-vendor-matches");
const vendorDocs = [...(vendorMatches?.querySelectorAll<HTMLElement>(".vendor-match") ?? [])].map((card, order) => ({
  card,
  key: card.dataset.vendor!,
  name: card.dataset.name ?? "",
  description: card.dataset.specialties ?? "",
  categories: [],
  tags: [],
  decades: [],
  order,
}));
const vendorIndex = buildIndex(vendorDocs);

function render() {
  list.replaceChildren(...results.slice(0, shown).map((doc) => renderCard(doc.card)));
  more.hidden = results.length <= shown;
  const text = query.value.trim();
  empty.hidden = results.length > 0;
  empty.textContent = text
    ? `No catalog items matched “${text}”. Try fewer or simpler words, or clear the filters.`
    : "No items match these filters. Clear a filter to see more.";
  const filtered = text || category.value || decade.value || vendor?.value || kind.value;
  const showing = results.length > shown ? `, showing ${formatNumber(shown)}` : "";
  count.textContent = filtered
    ? `${formatNumber(results.length)} matching ${results.length === 1 ? "item" : "items"}${showing}`
    : `${formatNumber(docs.length)} items, listed alphabetically${showing}`;
}

function showVendorMatches() {
  if (!vendorMatches) return;
  const found = rankText(vendorIndex, query.value);
  const shownCards = new Set(found.map((doc) => doc.card));
  vendorMatches.querySelector("ul")!.replaceChildren(...found.map((doc) => doc.card), ...vendorDocs.filter((doc) => !shownCards.has(doc.card)).map((doc) => doc.card));
  for (const doc of vendorDocs) doc.card.hidden = !shownCards.has(doc.card);
  vendorMatches.hidden = found.length === 0;
}

function update() {
  showVendorMatches();
  if (!index) return;
  results = search(index, query.value, { category: category.value, decade: decade.value, vendor: vendor?.value ?? "", kind: kind.value });
  shown = PAGE_SIZE;
  render();
}

let timer: ReturnType<typeof setTimeout> | undefined;
query.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(update, 120);
});
form.addEventListener("submit", (event) => event.preventDefault());
category.addEventListener("change", update);
decade.addEventListener("change", update);
vendor?.addEventListener("change", update);
kind.addEventListener("change", update);
more.addEventListener("click", () => {
  shown += PAGE_SIZE;
  render();
});

count.textContent = "Loading items…";
// A scene result links here as /props#q=<prop>, and the search starts from it.
const linkedQuery = queryFromHash(location.hash);
if (linkedQuery) {
  query.value = linkedQuery;
  update();
}
loadCards(list.dataset.cardsUrl!).then(
  (loaded: Card[]) => {
    docs = loaded.map((card) => ({ ...searchDocFromCard(card), card }));
    index = buildIndex(docs);
    update();
  },
  () => {
    count.textContent = LOAD_FAILED;
  },
);
