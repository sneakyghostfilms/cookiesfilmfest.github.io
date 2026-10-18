import { USER_AGENT } from './site-fetch.mjs';

const PRODUCT_TOKEN = USER_AGENT.split('/')[0];

function linesOf(text) {
  return String(text).split(/\r\n|\r|\n/).map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean).map((line) => {
    const colon = line.indexOf(':');
    return colon < 0 ? { key: '', value: line } : { key: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() };
  });
}

// Lines before the first User-agent belong to no group. RFC 9309 ignores them, but a site can put its Crawl-delay there
// (Bespoke's sits above Yoast's block, indented with a tab), so they apply to every agent. Only Disallow and Crawl-delay
// are ever read, so they can only make us more careful.
function groupsOf(text) {
  const groups = [];
  const preamble = [];
  let current = null;
  for (const { key, value } of linesOf(text)) {
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.split('/')[0].trim().toLowerCase());
    } else if (current) {
      current.rules.push({ key, value });
    } else {
      preamble.push({ key, value });
    }
  }
  return { groups, preamble };
}

// RFC 9309 §2.2.3: '*' matches any run of characters and a final '$' anchors the end; rules are matched from the start
// of the path and query. A rule may also start with '*', which matches any run of characters, the leading '/' included,
// as Google's matcher reads it ("*/feed/" refuses "/feed/"). A '$' anywhere else, or a rule starting with anything but
// '/' or '*', is not something we apply.
function patternOf(rule) {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  if (!/^[/*]/.test(body) || body.includes('$')) return null;
  return new RegExp(`^${body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
}

export function robotsRules(text, agent = PRODUCT_TOKEN) {
  const { groups, preamble } = groupsOf(text);
  const named = groups.filter((group) => group.agents.includes(agent.toLowerCase()));
  const chosen = named.length ? named : groups.filter((group) => group.agents.includes('*'));
  const rules = { group: named.length ? agent : chosen.length ? '*' : null, disallow: [], crawlDelaySeconds: null, unsupported: [] };
  for (const { key, value } of [...preamble, ...chosen.flatMap((group) => group.rules)]) {
    if (key === 'disallow') {
      if (!value) continue;
      if (!patternOf(value)) rules.unsupported.push(`Disallow: ${value}`);
      else rules.disallow.push(value);
    } else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(seconds)) rules.unsupported.push(`Crawl-delay: ${value}`);
      else rules.crawlDelaySeconds = Math.max(rules.crawlDelaySeconds ?? 0, seconds);
    }
  }
  return rules;
}

export function robotsAllow(rules, target) {
  return !rules.disallow.some((rule) => patternOf(rule).test(target));
}

export function robotsTarget(url) {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

export function robotsStopReason(rules, urls, host) {
  if (rules.unsupported.length) return `robots.txt on ${host} has rules this tool can't apply with certainty (${rules.unsupported.join('; ')}); stopping before any request to it`;
  const disallowed = urls.map(robotsTarget).filter((target) => !robotsAllow(rules, target));
  if (disallowed.length) return `robots.txt on ${host} disallows ${disallowed.length} of the ${urls.length} photo paths, for example ${disallowed.slice(0, 3).join(', ')}; stopping before any photo`;
  return null;
}
