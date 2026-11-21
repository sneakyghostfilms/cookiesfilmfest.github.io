import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';

const dist = new URL('../dist/', import.meta.url);
const cssNames = (await readdir(new URL('_astro/', dist))).filter(name => name.endsWith('.css'));
const css = postcss.parse((await Promise.all(cssNames.map(name => readFile(new URL(`_astro/${name}`, dist), 'utf8')))).join('\n'));
const home = await readFile(new URL('index.html', dist), 'utf8');

// Media conditions under which the scoped `.className` rule sets `display` to the given value.
function mediaSettingDisplay(className, display) {
  const conditions = [];
  css.walkAtRules('media', atRule => {
    atRule.walkDecls('display', decl => {
      if (decl.parent.selector.includes(`.${className}[`) && decl.value === display) conditions.push(atRule.params);
    });
  });
  return conditions;
}

const resourcesLinks = [
  ['https://propsnagger.com', 'PropSnagger'],
  ['/pa-festivals', 'PA Fests'],
  ['/comedy-festivals', 'Comedy Fests'],
];

test('the hamburger replaces the nav links on narrow viewports only, never short ones', () => {
  for (const [className, display] of [['nav-desktop', 'none'], ['mobile-menu-trigger', 'flex']]) {
    const conditions = mediaSettingDisplay(className, display);
    assert.equal(conditions.length, 1, className);
    assert.match(conditions[0], /^\((max-width:\s*1000px|width\s*<=\s*1000px)\)$/, className);
  }
});

test('the supporters column hides on phones and on short viewports', () => {
  const conditions = mediaSettingDisplay('sponsors', 'none');
  assert.equal(conditions.length, 1);
  assert.match(conditions[0], /(max-width:\s*640px|width\s*<=\s*640px)/);
  assert.match(conditions[0], /(max-height:\s*35em|height\s*<=\s*35em)/);
});

test('both menus list Resources with PropSnagger first, opening in a new tab', () => {
  assert.ok(!home.includes('Other Fests'));
  const headings = [...home.matchAll(/>\s*Resources\s*</g)];
  assert.equal(headings.length, 2, 'expected the desktop link group and the mobile menu');
  for (const heading of headings) {
    const anchors = [...home.slice(heading.index).matchAll(/<a\s([^>]*)>\s*([^<]*?)\s*<\/a>/g)].slice(0, resourcesLinks.length);
    assert.deepEqual(anchors.map(([, attrs, text]) => [attrs.match(/href="([^"]*)"/)[1], text]), resourcesLinks);
    assert.match(anchors[0][1], /target="_blank"/);
    assert.match(anchors[0][1], /rel="noopener noreferrer"/);
  }
});
