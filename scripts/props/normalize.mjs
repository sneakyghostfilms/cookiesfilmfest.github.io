const ERA_LINES = [
  /^\d{4}S?(?:\s*[/-]\s*\d{2,4}S?)*(?:\s+STYLE)?$/,
  /^\d{2}\/\d{2}\/\d{4}$/,
  /^(?:WWII|WWI|Y2K)(?:\s+(?:ERA|STYLE))?$/,
];

export function isEraLine(text) {
  return ERA_LINES.some((pattern) => pattern.test(text));
}

export function splitEra(lines) {
  const last = lines.at(-1) ?? "";
  if (lines.length > 1 && isEraLine(last)) {
    return { nameLines: lines.slice(0, -1), era: last, separator: " " };
  }
  const trailing = last.match(/^(.*\S),\s+(\S.*)$/);
  if (trailing && isEraLine(trailing[2])) {
    return { nameLines: [...lines.slice(0, -1), trailing[1]], era: trailing[2], separator: ", " };
  }
  return { nameLines: lines, era: null, separator: null };
}

export function decadesOf(era) {
  if (!era) return [];
  const date = era.match(/^\d{2}\/\d{2}\/(\d{4})$/);
  if (date) return [Math.floor(Number(date[1]) / 10) * 10];
  let century = 1900;
  const decades = [...era.matchAll(/(\d{2,4})S?/g)].map(([, digits]) => {
    if (digits.length === 4) {
      century = Math.floor(Number(digits) / 100) * 100;
      return Math.floor(Number(digits) / 10) * 10;
    }
    return century + Math.floor(Number(digits) / 10) * 10;
  });
  if (decades.length === 2 && /\dS?\s*-\s*\d/.test(era)) {
    const range = [];
    for (let decade = decades[0]; decade <= decades[1]; decade += 10) range.push(decade);
    return range;
  }
  return [...new Set(decades)].sort((a, b) => a - b);
}

export function displayEra(era) {
  return era.replace(/(\d)S\b/g, "$1s");
}

export function itemNumbersOf(printedIds) {
  return printedIds.map((printed) => printed.replace(/\D/g, ""));
}

function categoryFor(page, sections) {
  const before = sections.filter((section) => section.page <= page);
  return before.length ? before[before.length - 1].title : null;
}

export function buildItems({ cards, sections }, { vendor, catalog }) {
  const groups = new Map();
  for (const card of cards) {
    const itemNumbers = itemNumbersOf(card.printedIds);
    const { nameLines, era } = splitEra(card.captionLines);
    const description = card.captionLines.join(" ");
    const identity = `${itemNumbers.join("-")}|${description}`;
    const category = categoryFor(card.page, sections);
    const existing = groups.get(identity);
    if (existing) {
      if (!existing.pages.includes(card.page)) existing.pages.push(card.page);
      if (category && !existing.categories.includes(category)) existing.categories.push(category);
      continue;
    }
    groups.set(identity, {
      vendor: vendor.id,
      catalog: catalog.id,
      itemNumbers,
      printedIds: card.printedIds,
      name: nameLines.join(" "),
      description,
      categories: category ? [category] : [],
      era,
      decades: decadesOf(era),
      pages: [card.page],
    });
  }
  const items = [...groups.values()];
  const descriptionsByNumbers = new Map();
  for (const item of items) {
    const numbers = item.itemNumbers.join("-");
    if (!descriptionsByNumbers.has(numbers)) descriptionsByNumbers.set(numbers, []);
    descriptionsByNumbers.get(numbers).push(item);
  }
  for (const [numbers, sharing] of descriptionsByNumbers) {
    sharing.forEach((item, index) => {
      if (!numbers) item.key = `${vendor.keyPrefix}-noid-${index + 1}`;
      else if (sharing.length === 1) item.key = `${vendor.keyPrefix}-${numbers}`;
      else item.key = `${vendor.keyPrefix}-${numbers}-${index + 1}`;
    });
  }
  return items.map(({ key, ...fields }) => ({ key, ...fields }));
}

export function checkItems(items, { pageCount, sectionTitles }) {
  const problems = [];
  const keys = new Set();
  for (const item of items) {
    const label = item.key ?? JSON.stringify(item.printedIds);
    if (!item.key || keys.has(item.key)) problems.push(`${label}: missing or duplicate key`);
    keys.add(item.key);
    if (!item.name || !item.description) problems.push(`${label}: missing name or description`);
    if (!item.pages?.length || item.pages.some((page) => !Number.isInteger(page) || page < 1 || page > pageCount)) {
      problems.push(`${label}: page outside 1..${pageCount}`);
    }
    if (!item.categories?.length || item.categories.some((category) => !sectionTitles.includes(category))) {
      problems.push(`${label}: category is not a section divider title`);
    }
    const rebuilt = item.era === null ? [item.name] : [`${item.name} ${item.era}`, `${item.name}, ${item.era}`];
    if (!rebuilt.includes(item.description)) problems.push(`${label}: name and era do not rebuild the description`);
    if (item.itemNumbers.join() !== itemNumbersOf(item.printedIds).join()) problems.push(`${label}: item numbers differ from printed IDs`);
    if (JSON.stringify(item.decades) !== JSON.stringify(decadesOf(item.era))) problems.push(`${label}: decades not derived from era`);
  }
  return problems;
}

export function serializeInventory(inventory) {
  const items = inventory.items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  const catalogs = JSON.stringify(inventory.catalogs, null, 2).replace(/\n/g, '\n  ');
  return `{\n  "schemaVersion": ${inventory.schemaVersion},\n  "catalogs": ${catalogs},\n  "items": [\n${items}\n  ]\n}\n`;
}
