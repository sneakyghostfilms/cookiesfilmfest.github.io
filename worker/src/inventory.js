import inventory from '../../src/data/props/inventory.json' with { type: 'json' };

export const inventoryKeys = new Set(inventory.items.map((item) => item.key));

function listing(items) {
  const sections = new Map();
  for (const item of items) {
    const section = item.categories[0] ?? 'OTHER';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push([item.key, item.name, item.era].filter(Boolean).join(' | '));
  }
  return [...sections].map(([section, lines]) => `## ${section}\n${lines.join('\n')}`).join('\n');
}

export const inventoryText = listing(inventory.items);
