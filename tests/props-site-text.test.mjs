import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSiteItems } from '../scripts/props/site-items.mjs';
import { attribute, decodeEntities, visibleText } from '../scripts/props/sites/html-text.mjs';

test('named entities decode: the six HTML ones in any case, the Latin-1 names and common typography exactly, and an unknown one stays', () => {
  assert.equal(decodeEntities('&amp; &AMP; &lt;b&gt; &quot;x&quot; &apos;y&apos; a&nbsp;b'), '& & <b> "x" \'y\' a b');
  assert.equal(decodeEntities('D&eacute;cor, &Eacute;t&eacute;, cr&egrave;me, na&iuml;ve, &frac12; in, 90&deg;, &sup2;, &yuml;'), 'Décor, Été, crème, naïve, ½ in, 90°, ², ÿ');
  assert.equal(decodeEntities('1950s&ndash;60s &mdash; &lsquo;a&rsquo; &ldquo;b&rdquo;&hellip; &bull; &trade; &euro;5'), '1950s–60s — ‘a’ “b”… • ™ €5');
  assert.equal(decodeEntities('&#8203;&#x2014;&#39;'), `${String.fromCodePoint(0x200b)}—'`);
  assert.equal(decodeEntities('&zzz; &EACUTEX; & ; &#0;'), '&zzz; &EACUTEX; & ; &#0;');
  assert.equal(attribute("<a title='Caf&eacute; &amp; Bar'>", 'title'), 'Café & Bar');
});

test('visible text joins inline elements with nothing, puts a space at block ends, and drops zero-width characters', () => {
  assert.equal(visibleText('<p><span>Mimosas</span><span>, Mascara &amp; More</span></p>'), 'Mimosas, Mascara & More');
  assert.equal(visibleText('<h2>&#8203;&#8203;<font color="#d5d5d5">Lamps</font></h2><p>Brass<br>and tin</p><div>One</div><div>Two</div>'), 'Lamps Brass and tin One Two');
  assert.equal(visibleText('<span>  D&eacute;cor\n\t and   Linens </span>'), 'Décor and Linens');
  assert.equal(visibleText(`<p>${String.fromCodePoint(0x200b)}</p>`), '');
  assert.equal(visibleText('A<div>B</div>'), 'A B', 'an opening block tag adds a space too');
  assert.equal(visibleText('<span>A</span><p class="x">B</p>'), 'A B');
});

test('a name, category or era that still holds an entity is refused, naming only the entity', () => {
  const vendor = { id: 'text-test', keyPrefix: 'tt' };
  const catalog = { id: 'tt-test', type: 'weebly-gallery', siteUrl: 'https://text.example/' };
  const item = (fields) => ({ key: 'tt-abc123', vendor: 'text-test', catalog: 'tt-test', name: 'Lamp', description: null, categories: ['Lamps'], era: null, decades: [], url: 'https://text.example/lamps.html', ...fields });
  assert.deepEqual(checkSiteItems([item({})], { vendor, catalog }), []);
  assert.deepEqual(checkSiteItems([item({ name: 'Salt & pepper; set' })], { vendor, catalog }), [], 'an ampersand that is not an entity is fine');
  assert.deepEqual(checkSiteItems([item({ name: 'D&eacute;cor lamp' })], { vendor, catalog }), ['tt-abc123: name holds &eacute;, an HTML entity that was not decoded']);
  assert.deepEqual(checkSiteItems([item({ categories: ['R&amp;D'] })], { vendor, catalog }), ['tt-abc123: category holds &amp;, an HTML entity that was not decoded']);
  assert.deepEqual(checkSiteItems([item({ name: 'Bad &#0; code' })], { vendor, catalog }), ['tt-abc123: name holds &#0;, an HTML entity that was not decoded']);
});
