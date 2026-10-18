import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The props pages' browser scripts must reach no Node module and no build-side code. The built bundle alone can't
// show it: a stray import of a build-side module makes the build pull in its Node imports, yet tree-shaking can drop
// every trace of them from the bundle. So this walks the import graph from each props page's <script> instead.
const root = fileURLToPath(new URL('../', import.meta.url));
const NODE_MODULES = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const BUILD_SIDE = /^(scripts\/props\/|src\/scripts\/props-cards(-file)?\.js$)/;
const PAGES = ['src/pages/props.astro', ...readdirSync(path.join(root, 'src/pages/props'))
  .filter((file) => file.endsWith('.astro')).map((file) => `src/pages/props/${file}`)];

// Specifiers of `import … from`, `export … from`, side-effect imports and dynamic imports of a string literal.
function specifiers(source) {
  const pattern = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3]);
}

function chain(importer, file) {
  const files = [file];
  while (importer.has(files[0])) files.unshift(importer.get(files[0]));
  return files.join(' → ');
}

// Every file a page's bundled <script> tags reach through relative imports (each with the file that first imported
// it), and every import of a Node module or build-side file on the way.
function walk(page) {
  const markup = readFileSync(path.join(root, page), 'utf8');
  const scripts = [...markup.matchAll(/<script\b(?![^>]*\bis:inline\b)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const importer = new Map();
  const problems = [];
  const queue = [[page, scripts.join('\n')]];
  while (queue.length) {
    const [file, source] = queue.shift();
    for (const specifier of specifiers(source)) {
      if (NODE_MODULES.has(specifier) || specifier.startsWith('node:')) {
        problems.push(`${chain(importer, file)} imports ${specifier}`);
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (BUILD_SIDE.test(target)) {
        problems.push(`${chain(importer, file)} imports ${target}`);
        continue;
      }
      if (target === page || importer.has(target)) continue;
      assert.ok(existsSync(path.join(root, target)), `${file} imports ${specifier}, which doesn't exist`);
      importer.set(target, file);
      queue.push([target, readFileSync(path.join(root, target), 'utf8')]);
    }
  }
  return { importer, problems };
}

test('import specifiers are found in every form the client code could use', () => {
  const source = [
    'import { a, type B } from "./a.ts";',
    "import c from './c.js'",
    'import {\n  d,\n  e,\n} from "./d.js";',
    'import "./side-effect.ts";',
    "export { f } from './f.js';",
    "export * from './g.js';",
    "const h = await import('./h.js');",
    "import * as i from 'fs';",
  ].join('\n');
  assert.deepEqual(specifiers(source), ['./a.ts', './c.js', './d.js', './side-effect.ts', './f.js', './g.js', './h.js', 'fs']);
});

test("the walk starts at each props page's script and follows imports to the bottom", () => {
  assert.deepEqual(PAGES, ['src/pages/props.astro']);
  const { importer } = walk('src/pages/props.astro');
  assert.equal(chain(importer, 'src/scripts/props-card-text.js'), 'src/pages/props.astro → src/scripts/props-page.ts → src/scripts/props-card-text.js');
  assert.equal(chain(importer, 'src/scripts/props-search.js'), 'src/pages/props.astro → src/scripts/props-page.ts → src/scripts/props-search.js');
  assert.ok(importer.has('src/scripts/props-card-view.ts') && importer.has('src/scripts/props-scene.js'));
});

test('no props page script reaches a Node module or build-side code, even code tree-shaking would drop', () => {
  for (const page of PAGES) assert.deepEqual(walk(page).problems, [], page);
});
