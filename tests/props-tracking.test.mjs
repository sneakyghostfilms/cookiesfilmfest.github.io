import assert from 'node:assert/strict';
import test from 'node:test';
import { REDACTED, TRACKING_PARAMETERS, redactTracking } from '../scripts/props/tracking.mjs';

const html = (text) => redactTracking(Buffer.from(text, 'utf8'), 'text/html; charset=UTF-8');
const redacted = (text) => {
  const result = html(text);
  return [result.body.toString('utf8'), result.redacted];
};
// Built at run time: the tests need the six characters of a JSON escape (a backslash, then u0026), not the ampersand.
const BACKSLASH = String.fromCharCode(92);
const JSON_AMPERSAND = `${BACKSLASH}u0026`;

test('tracking values in links, form actions, sources and inputs are replaced, and only their names are listed', () => {
  assert.deepEqual(redacted('<a href="/list/?gclid=Ab-C_1.2&amp;page=2">Next</a>'), ['<a href="/list/?gclid=REDACTED&amp;page=2">Next</a>', ['gclid']]);
  assert.deepEqual(redacted("<a href='/list/?view=grid&amp;utm_source=letter&amp;utm_medium=mail#top'>"), ["<a href='/list/?view=grid&amp;utm_source=REDACTED&amp;utm_medium=REDACTED#top'>", ['utm_medium', 'utm_source']]);
  assert.deepEqual(redacted('<a href="/list/?view=grid&#038;fbclid=Q7">more</a>'), ['<a href="/list/?view=grid&#038;fbclid=REDACTED">more</a>', ['fbclid']]);
  assert.deepEqual(redacted('<form method="get" action="/search/?msclkid=made-up"><button>Go</button></form>'), ['<form method="get" action="/search/?msclkid=REDACTED"><button>Go</button></form>', ['msclkid']]);
  assert.deepEqual(
    redacted(`<input type="hidden" name="_hsenc" value="made.up"><input value='made-up' type='hidden' name='GCLID'><input type=hidden name=igshid value=madeup>`),
    [`<input type="hidden" name="_hsenc" value="REDACTED"><input value='REDACTED' type='hidden' name='GCLID'><input type=hidden name=igshid value=REDACTED>`, ['_hsenc', 'gclid', 'igshid']],
  );
  assert.deepEqual(redacted('<img src="https://cdn.example/a.jpg?ttclid=x1"><meta property="og:url" content="https://shop.example/?twclid=x2">'), ['<img src="https://cdn.example/a.jpg?ttclid=REDACTED"><meta property="og:url" content="https://shop.example/?twclid=REDACTED">', ['ttclid', 'twclid']]);
  assert.deepEqual(redacted('<div style="background:url(/a.jpg?utm_source=x9)">'), ['<div style="background:url(/a.jpg?utm_source=REDACTED)">', ['utm_source']], 'a value ends at a closing parenthesis');
  assert.deepEqual(redacted('<input type="hidden" name="_kx" data-value="kept" value="tok">'), ['<input type="hidden" name="_kx" data-value="kept" value="REDACTED">', ['_kx']], 'data-value is not the value');
});

test('a JSON-escaped ampersand and a percent-encoded query are read too', () => {
  const json = `{"link":"https:${BACKSLASH}/${BACKSLASH}/shop.example${BACKSLASH}/?id=7${JSON_AMPERSAND}fbclid=Q7${JSON_AMPERSAND}page=2","note":"ok"}`;
  const result = redactTracking(Buffer.from(json), 'application/json');
  assert.equal(result.body.toString(), json.replace('fbclid=Q7', 'fbclid=REDACTED'));
  assert.deepEqual(result.redacted, ['fbclid']);
  assert.deepEqual(JSON.parse(result.body.toString()), { link: 'https://shop.example/?id=7&fbclid=REDACTED&page=2', note: 'ok' }, 'the redacted body is still valid JSON');
  const share = '<a href="https://share.example/?u=https%3A%2F%2Fshop.example%2F%3F_kx%3Dtok.1%26page%3D2%26utm_campaign%3Dfall%2523%23top">share</a>';
  assert.deepEqual(redacted(share), ['<a href="https://share.example/?u=https%3A%2F%2Fshop.example%2F%3F_kx%3DREDACTED%26page%3D2%26utm_campaign%3DREDACTED%23top">share</a>', ['_kx', 'utm_campaign']]);
  assert.deepEqual(redacted('?u=a%3fgclid%3dv1'), ['?u=a%3fgclid%3dREDACTED', ['gclid']], 'percent-encoding in lower case');
});

test('a one-character value and a value full of regex characters are replaced where they stand, and nothing else changes', () => {
  assert.deepEqual(redacted('<p>Page 1 of 1</p><a href="/list/?_kx=1">1</a>'), ['<p>Page 1 of 1</p><a href="/list/?_kx=REDACTED">1</a>', ['_kx']]);
  const special = 'a.b*c+(d[e]{f}|g^h$i?j';
  assert.deepEqual(redacted(`<a href="/x/?mc_eid=${special}">${special}</a>`), [`<a href="/x/?mc_eid=REDACTED">${special}</a>`, ['mc_eid']]);
});

test('every listed parameter is replaced and listed under its own name; utm_ covers any utm_ name', () => {
  assert.equal(TRACKING_PARAMETERS.length, 23);
  for (const listed of TRACKING_PARAMETERS) {
    for (const name of listed === 'utm_*' ? ['utm_source', 'utm_campaign', 'utm_source_platform'] : [listed]) {
      assert.deepEqual(redacted(`<a href="/p/?id=7&${name}=v1">`), [`<a href="/p/?id=7&${name}=REDACTED">`, [name]], name);
    }
  }
});

test('what is not a tracking value is left alone: empty values, longer names, prose, other inputs, and REDACTED itself', () => {
  for (const text of [
    '<a href="/p/?gclid=&amp;page=2">',
    '<input type="hidden" name="gclid" value=""><input type="hidden" name="fbclid">',
    '<a href="/p/?xgclid=abc&amp;gclidx=abc&amp;_gat=1&amp;_gac=2">',
    '<input type="hidden" name="gclidx" value="kept"><input type="hidden" name="xgclid" value="kept">',
    '<p>We never use utm_source tags.</p>',
    '<input type="hidden" data-name="gclid" value="kept"><input type="hidden" name="page" value="2">',
    `<a href="/p/?_kx=${REDACTED}">`,
  ]) {
    const result = html(text);
    assert.deepEqual([result.body.toString('utf8'), result.redacted], [text, []], text);
  }
});

test('a body without a content type is read as text', () => {
  for (const type of [null, undefined, '']) {
    const result = redactTracking(Buffer.from('<a href="/?gclid=v1">'), type);
    assert.deepEqual([result.body.toString(), result.redacted], ['<a href="/?gclid=REDACTED">', ['gclid']], String(type));
  }
});

test('a body with nothing to replace, and any photo, come back as the very same bytes', () => {
  const clean = Buffer.from('<a href="/list/?page=2&amp;view=list">', 'utf8');
  assert.equal(redactTracking(clean, 'text/html').body, clean);
  const photo = Buffer.from([0xff, 0xd8, ...Buffer.from('?gclid=abc'), 0xff, 0xd9]);
  for (const type of ['image/jpeg', 'image/webp', 'application/octet-stream']) assert.deepEqual(redactTracking(photo, type), { body: photo, redacted: [] }, type);
  const latin = Buffer.from([0xe9, 0x3f, ...Buffer.from('gclid=v&x=1'), 0xff]);
  assert.deepEqual([...redactTracking(latin, 'text/html').body], [0xe9, 0x3f, ...Buffer.from('gclid=REDACTED&x=1'), 0xff], 'bytes that are not UTF-8 survive');
});
