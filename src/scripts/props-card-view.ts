import { cardText } from "./props-card-text.js";
import { KIND_LABELS } from "./props-kinds.js";

// Loading /props/cards.json and drawing its cards, for any page that shows items. Every card is built from elements
// and text nodes, never from an HTML string, so no vendor text is ever parsed as markup.

export type Card = ReturnType<typeof cardText>;

export async function loadCards(url: string): Promise<Card[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cards.json answered HTTP ${response.status}`);
  const file = await response.json();
  return file.items.map((entry: Parameters<typeof cardText>[0]) => cardText(entry, file));
}

function span(className: string, text: string) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function paragraph(className: string, ...children: (Node | string)[]) {
  const node = document.createElement("p");
  node.className = className;
  node.append(...children);
  return node;
}

function externalLink(href: string, label: string) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

export function renderCard(card: Card) {
  const item = document.createElement("li");
  item.className = "prop-card";
  item.dataset.key = card.key;
  item.dataset.vendor = card.vendorId;
  if (card.thumb) {
    const image = document.createElement("img");
    image.className = "prop-thumb";
    image.src = card.thumb.src;
    image.width = card.thumb.width;
    image.height = card.thumb.height;
    image.alt = card.alt ?? "";
    if (card.photoCredit) image.title = card.photoCredit;
    image.loading = "lazy";
    image.decoding = "async";
    item.append(image);
  }
  const meta = paragraph("prop-meta", span("prop-vendor", card.vendorName));
  if (card.ids) meta.append(" ", span("prop-ids", card.ids));
  if (card.pages) meta.append(" ", span("prop-page", card.pages));
  if (card.era) meta.append(" ", span("prop-era", card.era));
  meta.append(" ", span("prop-kind", KIND_LABELS[card.kind]));
  item.append(paragraph("prop-name", card.name), meta);
  if (card.categories.length) item.append(paragraph("prop-category", card.categories.join(", ")));
  const actions = paragraph("prop-actions", externalLink(card.link.href, card.link.label));
  if (card.inquire) {
    const inquire = externalLink(card.inquire, "Inquire");
    inquire.title = card.cite;
    actions.append(" ", inquire);
  }
  item.append(actions);
  return item;
}
