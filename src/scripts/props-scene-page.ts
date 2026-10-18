import { type Card, loadCards, renderCard } from "./props-card-view.ts";
import { cardsForScene, checkSceneText, keepKnownKeys, periodNote, requestScene, trackCards } from "./props-scene.js";
import { keywordSearchHref } from "./props-search-link.js";

type SceneEntry = { prop: string; reason: string; keys: string[] };

const sceneForm = document.getElementById("scene-form") as HTMLFormElement;
const sceneText = document.getElementById("scene-text") as HTMLTextAreaElement;
const scenePeriod = document.getElementById("scene-period") as HTMLInputElement;
const sceneCount = document.getElementById("scene-count") as HTMLElement;
const sceneSubmit = document.getElementById("scene-submit") as HTMLButtonElement;
const sceneStatus = document.getElementById("scene-status") as HTMLElement;
const sceneResults = document.getElementById("scene-results") as HTMLElement;
const apiUrl = sceneForm.dataset.apiUrl ?? "";
// The item list loads with the first scene, alongside the AI request, so a visit that sends none downloads no item data.
let cards: ReturnType<typeof trackCards> | undefined;

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

function propBlock(entry: SceneEntry, cardsByKey: Map<string, Card>) {
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
    const link = element("a", "scene-search-link", `Search the catalog for “${entry.prop}”`) as HTMLAnchorElement;
    link.href = keywordSearchHref(entry.prop);
    missing.append(link);
    block.append(missing);
  }
  return block;
}

function group(title: string, entries: SceneEntry[], cardsByKey: Map<string, Card>) {
  const section = element("div", "scene-group");
  section.append(element("h3", "scene-group-title", title));
  if (!entries.length) section.append(element("p", "props-note", "None listed."));
  for (const entry of entries) section.append(propBlock(entry, cardsByKey));
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
  const itemList = (cards ??= trackCards(loadCards(sceneForm.dataset.cardsUrl!)));
  sceneSubmit.disabled = true;
  sceneResults.replaceChildren();
  showStatus("Matching props… this can take up to about 30 seconds for long scenes.");
  const period = scenePeriod.value;
  const state = await requestScene(apiUrl, sceneText.value, { period });
  sceneSubmit.disabled = false;
  if (state.kind === "ok") {
    const loaded = await cardsForScene(itemList, () => showStatus("Matching props… waiting for the item list"));
    if (!loaded.ok) {
      showStatus("The item list couldn't load, so matches can't be shown. Reload the page to try again.");
      return;
    }
    const cardsByKey = new Map((loaded.cards as Card[]).map((card) => [card.key, card]));
    const kept = keepKnownKeys(state, new Set(cardsByKey.keys()));
    if (!kept.required.length && !kept.optional.length) {
      showStatus("The AI didn't identify props in this text.");
      return;
    }
    showStatus("");
    sceneResults.append(group("Required by the scene", kept.required, cardsByKey), group("Optional set dressing", kept.optional, cardsByKey));
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
