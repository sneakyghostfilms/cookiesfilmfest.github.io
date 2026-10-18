// Tracking parameters whose values are replaced before a fetched page is cached: the lead's list of 21, plus _gl and
// _ga, which carry a visitor's client id. A value can identify a visitor, such as an email-click token that a page
// cache baked into its links, so only the parameter names are ever kept.
export const TRACKING_PARAMETERS = ['_kx', 'gad_source', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'mc_eid', 'mc_cid', 'utm_*', 'yclid', 'ttclid', 'twclid', 'li_fat_id', 'igshid', '_hsenc', '_hsmi', 'vero_id', 'oly_enc_id', 'oly_anon_id', '_openstat', '_gl', '_ga'];
export const REDACTED = 'REDACTED';

const NAME = TRACKING_PARAMETERS.map((name) => (name.endsWith('*') ? `${name.slice(0, -1)}[a-z0-9_]+` : name)).join('|');
const IS_TRACKING = new RegExp(`^(?:${NAME})$`, 'i');
// A name right after ?, & or ; (the end of &amp; or &#38;) or a JSON-escaped ampersand (a backslash, then u0026),
// then =, then the value up to the next &, #, quote, space, <, >, backslash or ).
const IN_QUERY = new RegExp(`([?&;]|\\x5cu0026)(${NAME})=([^&#"'\\s<>\\x5c)]+)`, 'gi');
// The same, percent-encoded inside another URL, as in a share link: %3F or %26, the name, %3D, then the value.
const IN_ENCODED_QUERY = new RegExp(`(%3F|%26)(${NAME})(%3D)((?:(?!%26|%23)[^&#"'\\s<>\\x5c)])+)`, 'gi');
const INPUT = /<input\b[^>]*>/gi;
const attributePattern = (name) => new RegExp(`(\\s${name}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
const NAME_ATTRIBUTE = attributePattern('name');
const VALUE_ATTRIBUTE = attributePattern('value');
const BINARY = /^\s*(?:(?:image|audio|video|font)\/|application\/(?:pdf|octet-stream|zip|gzip))/i;

// Each value is replaced where it was matched, never searched for elsewhere. A body is read as Latin-1 so that every
// other byte comes back unchanged; one with nothing to replace, and any binary body, is returned as it was.
export function redactTracking(body, contentType) {
  if (BINARY.test(contentType ?? '')) return { body, redacted: [] };
  const names = new Set();
  const replaced = (name, value) => {
    if (!value || value === REDACTED) return false;
    names.add(name.toLowerCase());
    return true;
  };
  const text = body.toString('latin1')
    .replace(INPUT, (tag) => {
      const named = tag.match(NAME_ATTRIBUTE);
      const name = named && (named[2] ?? named[3] ?? named[4]);
      if (!name || !IS_TRACKING.test(name)) return tag;
      return tag.replace(VALUE_ATTRIBUTE, (whole, lead, double, single, bare) => {
        if (!replaced(name, double ?? single ?? bare)) return whole;
        const quote = double !== undefined ? '"' : single !== undefined ? "'" : '';
        return `${lead}${quote}${REDACTED}${quote}`;
      });
    })
    .replace(IN_QUERY, (whole, before, name, value) => (replaced(name, value) ? `${before}${name}=${REDACTED}` : whole))
    .replace(IN_ENCODED_QUERY, (whole, before, name, equals, value) => (replaced(name, value) ? `${before}${name}${equals}${REDACTED}` : whole));
  return names.size ? { body: Buffer.from(text, 'latin1'), redacted: [...names].sort() } : { body, redacted: [] };
}
