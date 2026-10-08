import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';
import config from '../tailwind.config.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const legacy = JSON.parse(await readFile(new URL('./fixtures/legacy-fluid-typography.json', import.meta.url)));
const cssFiles = (await readdir(path.join(root, 'dist/_astro'))).filter(name => name.endsWith('.css'));
const productionCSS = postcss.parse((await Promise.all(cssFiles.map(name => readFile(path.join(root, 'dist/_astro', name), 'utf8')))).join('\n'));

function declarations(css, selector) {
  const result = {};
  css.walkRules(rule => {
    if (rule.selectors.includes(selector)) {
      rule.nodes.filter(node => node.type === 'decl').forEach(node => { result[node.prop] = node.value; });
    }
  });
  return result;
}

// Evaluate only trusted, generated arithmetic length expressions. The fixture's
// expected numbers came from the old plugin, not the replacement scale formula.
function pixels(value, width) {
  const expression = value
    .replace(/var\(--tw-leading,\s*([^)]+)\)/g, '$1')
    .replace(/var\(--tw-space-y-reverse\)/g, '0')
    .replace(/var\(--spacing\)/g, '.25rem')
    .replace(/calc\(/g, '(')
    .replace(/(-?[\d.]+)rem/g, `($1*${legacy.rootFontPixels})`)
    .replace(/(-?[\d.]+)vw/g, `($1*${width}/100)`)
    .replace(/(-?[\d.]+)px/g, '$1');
  assert.match(expression.replaceAll('clamp', ''), /^[\d\s.,+*/()\-]+$/, `Unsupported CSS expression: ${value}`);
  return Function('clamp', `return (${expression})`)((min, preferred, max) => Math.max(min, Math.min(preferred, max)));
}

function assertSize(value, expected, label) {
  legacy.viewportWidths.forEach((width, i) => {
    assert.ok(Math.abs(pixels(value, width) - expected[i]) < 0.001, `${label} at ${width}px: ${value}`);
  });
}

test('configured fluid typography retains the independently recorded legacy scale', () => {
  assert.deepEqual(Object.keys(config.theme.fontSize), Object.keys(legacy.sizes));
  for (const [name, expected] of Object.entries(legacy.sizes)) {
    const [size, options] = config.theme.fontSize[name];
    assertSize(size, expected.pixels, name);
    assert.equal(Number(options.lineHeight), expected.lineHeight, name);
  }
});

test('production CSS includes body typography and the client-script success typography', () => {
  for (const name of ['base', 'lg']) {
    const css = declarations(productionCSS, `.text-${name}`);
    assert.ok(css['font-size'], `Missing text-${name} in the real production build`);
    assertSize(css['font-size'], legacy.sizes[name].pixels, name);
    assert.equal(pixels(css['line-height'], 768), legacy.sizes[name].lineHeight);
  }
});

test('the real Vite integration compiles every fluid size and slash leading', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'festival-css-test-'));
  try {
    const entry = path.join(dir, 'fixture.css');
    const classes = [...Object.keys(legacy.sizes).map(name => `text-${name}`), 'text-lg/6'];
    await writeFile(entry, `@import ${JSON.stringify(path.join(root, 'src/styles/index.css'))};\n@source inline(${JSON.stringify(classes.join(' '))});\n`);
    const output = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [tailwindcss()],
      build: { write: false, cssMinify: true, cssCodeSplit: true, lib: { entry, formats: ['es'] } },
    });
    const css = postcss.parse([output].flat().flatMap(result => result.output).filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n'));
    for (const [name, expected] of Object.entries(legacy.sizes)) {
      const rule = declarations(css, `.text-${name}`);
      assertSize(rule['font-size'], expected.pixels, name);
      assert.equal(pixels(rule['line-height'], 768), expected.lineHeight, name);
    }
    const slash = declarations(css, '.text-lg\\/6');
    assertSize(slash['font-size'], legacy.sizes.lg.pixels, 'text-lg/6');
    assert.equal(pixels(slash['line-height'], 768), legacy.slashLeadingPixels['text-lg/6']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('emitted resets, legacy spacing, and removed flex aliases preserve site behavior', () => {
  assert.equal(declarations(productionCSS, 'button')['border-radius'], '2rem');
  assert.equal(declarations(productionCSS, 'input:not([type=hidden])')['background-color']?.toLowerCase(), 'field');
  assert.equal(declarations(productionCSS, 'p').margin, '0');
  assert.equal(declarations(productionCSS, '.flex-grow-0')['flex-grow'], '0');
  assert.equal(declarations(productionCSS, '.flex-shrink')['flex-shrink'], '1');
  for (const [name, expected] of Object.entries({ 'space-y-3': 12, 'space-y-4': 16, 'space-y-8': 32, 'space-y-16': 64 })) {
    const selector = `.${name}>:not([hidden])~:not([hidden])`;
    const rule = declarations(productionCSS, selector);
    assert.equal(pixels(rule['margin-top'], 768), expected, name);
    assert.equal(pixels(rule['margin-bottom'], 768), 0, name);
    productionCSS.walkRules(candidate => {
      if (candidate.selector.includes(`.${name}`)) {
        assert.ok(!candidate.selector.includes(':last-child'), `Changed v4 spacing selector leaked into ${name}`);
      }
    });
  }
});
