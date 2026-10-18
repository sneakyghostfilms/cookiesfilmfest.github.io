// HTML 4's Latin-1 entity names, for code points 160-255 in order, such as "&eacute;" in a Weebly page's "Décor".
const LATIN_1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ');
const NAMED = {
  ...Object.fromEntries(LATIN_1.map((name, index) => [name, String.fromCodePoint(160 + index)])),
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', trade: '™', euro: '€',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return NAMED[code] ?? NAMED[code.toLowerCase()] ?? entity;
  });
}

export function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2]) : null;
}

// The text a browser shows for a piece of markup: tags inside a line add nothing ("Mimosas" + ", Mascara"), a block
// tag or a line break adds a space; then entities are decoded, zero-width and other format characters dropped, and
// spaces collapsed.
export function visibleText(html) {
  const text = String(html).replace(/<br\s*\/?>|<\/?(?:p|div|li|h[1-6])\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '');
  return decodeEntities(text).replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
}
