import assert from 'node:assert/strict';
import test from 'node:test';
import { keywordSearchHref, queryFromHash } from '../src/scripts/props-search-link.js';

// The scene page's "Search the catalog for X" link and the keyword page's reading of it, through a real URL parse.
const linked = (prop) => new URL(keywordSearchHref(prop), 'https://cookiesfilmfest.com');

test("a scene's prop reaches the keyword page in the fragment, never in a query string", () => {
  assert.equal(keywordSearchHref('rotary phone'), '/props#q=rotary%20phone');
  for (const prop of ['rotary phone', 'table & chairs #2', 'a + b = c', '50% off', '“neon” sign', 'café ?q=x']) {
    const url = linked(prop);
    assert.deepEqual([url.pathname, url.search], ['/props', ''], prop);
    assert.equal(queryFromHash(url.hash), prop, prop);
  }
});

test('any other fragment leaves the keyword search empty', () => {
  for (const hash of ['', '#', '#q=', '#prop-sources', '#vendor-route-30-retro']) assert.equal(queryFromHash(hash), '', hash);
});
