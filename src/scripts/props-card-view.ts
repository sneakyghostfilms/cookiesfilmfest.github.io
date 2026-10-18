import { cardText } from "./props-card-text.js";

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
    image.loading = "lazy";
    image.decoding = "async";
    item.append(image);
  }
  const line = paragraph("prop-line", span("prop-vendor", card.vendorName));
  if (card.ids) line.append(" · ", span("prop-ids", card.ids));
  line.append(" · ", span("prop-name", card.name));
  if (card.era) line.append(" · ", span("prop-era", card.era));
  if (card.pages) line.append(" · ", span("prop-page", card.pages));
  item.append(line);
  if (card.categories.length) item.append(paragraph("prop-category", card.categories.join(" · ")));
  if (card.tags.length) item.append(paragraph("prop-tags", "AI-suggested search terms: ", span("prop-tag-list", card.tags.join(", "))));
  if (card.photoCredit) item.append(paragraph("prop-photo", card.photoCredit));
  const actions = paragraph("prop-actions", externalLink(card.link.href, card.link.label));
  if (card.inquire) actions.append(externalLink(card.inquire, "Inquire"));
  item.append(actions, paragraph("prop-cite", card.cite));
  return item;
}
