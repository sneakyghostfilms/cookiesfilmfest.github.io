import { USER_AGENT } from './site-fetch.mjs';

const PRODUCT_TOKEN = USER_AGENT.split('/')[0];

function linesOf(text) {
  return String(text).split(/\r\n|\r|\n/).map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean).map((line) => {
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
      current.agents.push(value.split('/')[0].trim().toLowerCase());
    } else if (current) {
      current.rules.push({ key, value });
    }
  }
  return groups;
}

export function robotsRules(text, agent = PRODUCT_TOKEN) {
  const groups = groupsOf(text);
  const named = groups.filter((group) => group.agents.includes(agent.toLowerCase()));
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

export function robotsStopReason(rules, urls, host) {
  if (rules.unsupported.length) return `robots.txt on ${host} has rules this tool can't apply with certainty (${rules.unsupported.join('; ')}); stopping before any request to it`;
  const disallowed = urls.map((url) => new URL(url).pathname).filter((path) => !robotsAllow(rules, path));
  if (disallowed.length) return `robots.txt on ${host} disallows ${disallowed.length} of the ${urls.length} photo paths, for example ${disallowed.slice(0, 3).join(', ')}; stopping before any photo`;
  return null;
}
