import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';

const dist = new URL('../dist/', import.meta.url);
const cssNames = (await readdir(new URL('_astro/', dist))).filter(name => name.endsWith('.css'));
const css = postcss.parse((await Promise.all(cssNames.map(name => readFile(new URL(`_astro/${name}`, dist), 'utf8')))).join('\n'));
const home = await readFile(new URL('index.html', dist), 'utf8');

// The comma-separated alternatives of each media query under which the scoped `.className`
// rule sets `display` to the given value, normalized to range syntax and sorted.
function mediaSettingDisplay(className, display) {
  const queries = [];
  css.walkAtRules('media', atRule => {
    atRule.walkDecls('display', decl => {
      if (decl.parent.selector.includes(`.${className}[`) && decl.value === display) {
        queries.push(atRule.params.split(',').map(condition => condition.replace(/\s+/g, '').replace(/^\(max-(width|height):(.+)\)$/, '($1<=$2)')).sort());
      }
    });
  });
  return queries;
}

// [href, text] of the links between a menu's "Resources" heading and the end of its container.
function resourcesMenus() {
  return [...home.matchAll(/>\s*Resources\s*</g)].map(heading => {
    const container = home.slice(heading.index, home.indexOf('</div>', heading.index));
    return [...container.matchAll(/<a\s([^>]*)>\s*([^<]*?)\s*<\/a>/g)].map(([, attrs, text]) => ({ attrs, link: [attrs.match(/href="([^"]*)"/)[1], text] }));
  });
}

test('the hamburger replaces the nav links on narrow viewports only, never short ones', () => {
  assert.deepEqual(mediaSettingDisplay('nav-desktop', 'none'), [['(width<=1000px)']]);
  assert.deepEqual(mediaSettingDisplay('mobile-menu-trigger', 'flex'), [['(width<=1000px)']]);
});

test('the supporters column hides on phones, or under 560px / 35em of height, whichever is taller', () => {
  assert.deepEqual(mediaSettingDisplay('sponsors', 'none'), [['(height<=35em)', '(height<=560px)', '(width<=640px)']]);
});

test('both menus list Resources with PropSnagger first, opening in a new tab', () => {
  assert.ok(!home.includes('Other Fests'));
  const menus = resourcesMenus();
  assert.equal(menus.length, 2, 'expected the desktop link group and the mobile menu');
  for (const anchors of menus) {
    assert.deepEqual(anchors.map(anchor => anchor.link), [
      ['https://propsnagger.com', 'PropSnagger'],
      ['/pa-festivals', 'PA Fests'],
      ['/comedy-festivals', 'Comedy Fests'],
    ]);
    assert.match(anchors[0].attrs, /target="_blank"/);
    assert.match(anchors[0].attrs, /rel="noopener noreferrer"/);
  }
});
