import { searchDocFromCard } from "./props-card-text.js";
import { type Card, loadCards, renderCard } from "./props-card-view.ts";
import { buildIndex, rankText, search } from "./props-search.js";
import { cardsForScene, checkSceneText, keepKnownKeys, periodNote, requestScene, trackCards } from "./props-scene.js";

const PAGE_SIZE = 24;
const LOAD_FAILED = "The item list couldn't load. Reload the page to try again.";
const list = document.getElementById("props-results") as HTMLOListElement;
const query = document.getElementById("props-query") as HTMLInputElement;
const category = document.getElementById("props-category") as HTMLSelectElement;
const decade = document.getElementById("props-decade") as HTMLSelectElement;
const vendor = document.getElementById("props-vendor") as HTMLSelectElement | null;
const count = document.getElementById("props-count") as HTMLElement;
const empty = document.getElementById("props-empty") as HTMLElement;
const more = document.getElementById("props-more") as HTMLButtonElement;
const form = document.getElementById("props-form") as HTMLFormElement;

type Doc = ReturnType<typeof searchDocFromCard> & { card: Card };
let docs: Doc[] = [];
let index: ReturnType<typeof buildIndex> | null = null;
let results: Doc[] = [];
let shown = PAGE_SIZE;
const cardsByKey = new Map<string, Card>();
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
  const filtered = text || category.value || decade.value || vendor?.value;
  count.textContent = filtered
    ? `${results.length} matching ${results.length === 1 ? "item" : "items"}${results.length > shown ? `, showing ${shown}` : ""}`
    : `${docs.length} items, listed alphabetically${results.length > shown ? `, showing ${shown}` : ""}`;
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
  results = search(index, query.value, { category: category.value, decade: decade.value, vendor: vendor?.value ?? "" });
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
more.addEventListener("click", () => {
  shown += PAGE_SIZE;
  render();
});

count.textContent = "Loading items…";
const cards = trackCards(loadCards(list.dataset.cardsUrl!));
cards.promise.then(
  (loaded: Card[]) => {
    for (const card of loaded) cardsByKey.set(card.key, card);
    docs = loaded.map((card) => ({ ...searchDocFromCard(card), card }));
    index = buildIndex(docs);
    update();
  },
  () => {
    count.textContent = LOAD_FAILED;
  },
);

const sceneForm = document.getElementById("scene-form") as HTMLFormElement;
const sceneText = document.getElementById("scene-text") as HTMLTextAreaElement;
const scenePeriod = document.getElementById("scene-period") as HTMLInputElement;
const sceneCount = document.getElementById("scene-count") as HTMLElement;
const sceneSubmit = document.getElementById("scene-submit") as HTMLButtonElement;
const sceneStatus = document.getElementById("scene-status") as HTMLElement;
const sceneResults = document.getElementById("scene-results") as HTMLElement;
const apiUrl = sceneForm.dataset.apiUrl ?? "";

function showStatus(text: string) {
  sceneStatus.textContent = text;
  sceneStatus.hidden = !text;
}

function element(tag: string, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function searchFor(prop: string) {
  query.value = prop;
  category.value = "";
  decade.value = "";
  if (vendor) vendor.value = "";
  update();
  list.scrollIntoView({ behavior: "smooth", block: "start" });
}

function propBlock(entry: { prop: string; reason: string; keys: string[] }) {
  const block = element("div", "scene-prop");
  block.append(element("h4", "scene-prop-name", entry.prop));
  if (entry.reason) block.append(element("p", "scene-reason", `AI: ${entry.reason}`));
  if (entry.keys.length) {
    const matches = element("ol", "props-results scene-matches");
    for (const key of entry.keys) {
      matches.append(renderCard(cardsByKey.get(key)!));
    }
    block.append(matches);
  } else {
    const missing = element("p", "scene-missing", "No matching item found. ");
    const link = element("button", "scene-search-link", `Search the catalog for “${entry.prop}”`) as HTMLButtonElement;
    link.type = "button";
    link.addEventListener("click", () => searchFor(entry.prop));
    missing.append(link);
    block.append(missing);
  }
  return block;
}

function group(title: string, entries: { prop: string; reason: string; keys: string[] }[]) {
  const section = element("div", "scene-group");
  section.append(element("h3", "scene-group-title", title));
  if (!entries.length) section.append(element("p", "props-note", "None listed."));
  for (const entry of entries) section.append(propBlock(entry));
  return section;
}

const MESSAGES: Record<string, string> = {
  rate_limited: "Too many requests right now. Wait a minute and try again.",
  busy: "The AI service is busy. Try again in a minute.",
  unavailable: "AI matching isn't available right now. Keyword search still works.",
  timeout: "AI matching didn't work this time. Keyword search still works. Try again later.",
  network: "AI matching didn't work this time. Keyword search still works. Try again later.",
  error: "AI matching didn't work this time. Keyword search still works. Try again later.",
};

sceneText.addEventListener("input", () => {
  sceneCount.textContent = sceneText.value.trim().length.toLocaleString("en-US");
});

sceneForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!apiUrl) return;
  const problem = checkSceneText(sceneText.value, scenePeriod.value);
  if (problem) {
    showStatus(problem);
    return;
  }
  sceneSubmit.disabled = true;
  sceneResults.replaceChildren();
  showStatus("Matching props… this can take up to about 30 seconds for long scenes.");
  const period = scenePeriod.value;
  const state = await requestScene(apiUrl, sceneText.value, { period });
  sceneSubmit.disabled = false;
  if (state.kind === "ok") {
    const loaded = await cardsForScene(cards, () => showStatus("Matching props… waiting for the item list"));
    if (!loaded.ok) {
      showStatus("The item list couldn't load, so matches can't be shown. Reload the page to try again.");
      return;
    }
    const kept = keepKnownKeys(state, new Set((loaded.cards as Card[]).map((card) => card.key)));
    if (!kept.required.length && !kept.optional.length) {
      showStatus("The AI didn't identify props in this text.");
      return;
    }
    showStatus("");
    sceneResults.append(group("Required by the scene", kept.required), group("Optional set dressing", kept.optional));
    const notes = [
      "The AI chose from the catalog items whose words match your scene. Props not listed above were not identified or have no match among them; try keyword search for them.",
      `Matched by AI (${kept.model}). AI can be wrong; check each item in the catalog and confirm availability with the vendor.`,
    ];
    const excluded = periodNote(period);
    if (excluded) notes.push(excluded);
    if (kept.ignored) notes.push(`${kept.ignored} AI ${kept.ignored === 1 ? "suggestion referred to an item that wasn't" : "suggestions referred to items that weren't"} on the list the AI was given and ${kept.ignored === 1 ? "was" : "were"} ignored.`);
    for (const note of notes) sceneResults.append(element("p", "props-note", note));
    return;
  }
  if (state.kind === "quota") {
    const local = state.resetsAt ? ` (about ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(state.resetsAt)})` : "";
    showStatus(`Today's AI matching budget is used up. Keyword search still works. AI matching resets at midnight UTC${local}.`);
    return;
  }
  showStatus(state.kind === "invalid" ? state.message ?? "Check the scene text and try again." : MESSAGES[state.kind]);
});
