export const ROBOTS_AGENT = 'PittsburghPropSearch';

function linesOf(text) {
  return String(text).split(/\r?\n/).map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean).map((line) => {
    const colon = line.indexOf(':');
    return colon < 0 ? { key: '', value: line } : { key: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() };
  });
}

function groupsOf(text) {
  const groups = [];
  let current = null;
  for (const { key, value } of linesOf(text)) {
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.rules.push({ key, value });
    }
  }
  return groups;
}

export function robotsRules(text, agent = ROBOTS_AGENT) {
  const groups = groupsOf(text);
  const named = groups.filter((group) => group.agents.some((name) => name !== '*' && agent.toLowerCase().includes(name)));
  const chosen = named.length ? named : groups.filter((group) => group.agents.includes('*'));
  const rules = { group: named.length ? agent : chosen.length ? '*' : null, disallow: [], crawlDelaySeconds: null, unsupported: [] };
  for (const { key, value } of chosen.flatMap((group) => group.rules)) {
    if (key === 'disallow') {
      if (!value) continue;
      if (!value.startsWith('/') || /[*$]/.test(value)) rules.unsupported.push(`Disallow: ${value}`);
      else rules.disallow.push(value);
    } else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(seconds)) rules.unsupported.push(`Crawl-delay: ${value}`);
      else rules.crawlDelaySeconds = Math.max(rules.crawlDelaySeconds ?? 0, seconds);
    }
  }
  return rules;
}

export function robotsAllow(rules, path) {
  return !rules.disallow.some((prefix) => path.startsWith(prefix));
}
