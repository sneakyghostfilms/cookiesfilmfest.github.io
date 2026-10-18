import { buildIndex, search } from "./props-search.js";
import { checkSceneText, keepKnownKeys, periodNote, requestScene } from "./props-scene.js";

const PAGE_SIZE = 24;
const list = document.getElementById("props-results") as HTMLOListElement;
const query = document.getElementById("props-query") as HTMLInputElement;
const category = document.getElementById("props-category") as HTMLSelectElement;
const decade = document.getElementById("props-decade") as HTMLSelectElement;
const vendor = document.getElementById("props-vendor") as HTMLSelectElement | null;
const count = document.getElementById("props-count") as HTMLElement;
const empty = document.getElementById("props-empty") as HTMLElement;
const more = document.getElementById("props-more") as HTMLButtonElement;
const form = document.getElementById("props-form") as HTMLFormElement;

const docs = [...list.querySelectorAll<HTMLElement>(".prop-card")].map((card) => {
  const name = card.querySelector(".prop-name")!.textContent ?? "";
  const era = card.querySelector(".prop-era")?.textContent ?? "";
  return {
    card,
    key: card.dataset.key!,
    name,
    description: `${name} ${era}`,
    categories: card.dataset.categories ? card.dataset.categories.split("|") : [],
    vendor: card.dataset.vendor!,
    tags: card.querySelector(".prop-tag-list")?.textContent?.split(", ") ?? [],
    decades: card.dataset.decades ? card.dataset.decades.split(" ").map(Number) : [],
    order: Number(card.dataset.order),
  };
});
const index = buildIndex(docs);
let results = docs;
let shown = PAGE_SIZE;

function render() {
  const visible = new Set(results.slice(0, shown));
  const matched = new Set(results);
  list.replaceChildren(...results.map((doc) => doc.card), ...docs.filter((doc) => !matched.has(doc)).map((doc) => doc.card));
  for (const doc of docs) doc.card.hidden = !visible.has(doc);
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

function update() {
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
render();

const sceneForm = document.getElementById("scene-form") as HTMLFormElement;
const sceneText = document.getElementById("scene-text") as HTMLTextAreaElement;
const scenePeriod = document.getElementById("scene-period") as HTMLInputElement;
const sceneCount = document.getElementById("scene-count") as HTMLElement;
const sceneSubmit = document.getElementById("scene-submit") as HTMLButtonElement;
const sceneStatus = document.getElementById("scene-status") as HTMLElement;
const sceneResults = document.getElementById("scene-results") as HTMLElement;
const apiUrl = sceneForm.dataset.apiUrl ?? "";
const cardsByKey = new Map(docs.map((doc) => [doc.key, doc.card]));

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
      const copy = cardsByKey.get(key)!.cloneNode(true) as HTMLElement;
      copy.hidden = false;
      matches.append(copy);
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
    const kept = keepKnownKeys(state, new Set(cardsByKey.keys()));
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
    if (kept.ignored) notes.push(`${kept.ignored} AI ${kept.ignored === 1 ? "suggestion referred to an item that doesn't" : "suggestions referred to items that don't"} exist and ${kept.ignored === 1 ? "was" : "were"} ignored.`);
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
