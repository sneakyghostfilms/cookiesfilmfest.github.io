import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ROOT } from './catalog-pdf.mjs';

export function privateOutputProblem(path, root = ROOT) {
  const resolved = resolve(root, path);
  const inside = relative(root, resolved);
  if (inside.startsWith('..') || isAbsolute(inside)) return `${resolved} is outside the repository`;
  const top = inside.split(/[\\/]/)[0];
  if (top === 'public' || top === 'src') return `${resolved} is under ${top}/`;
  const check = spawnSync('git', ['-C', root, 'check-ignore', '-q', join(resolved, 'probe.webp')]);
  if (check.status !== 0) return `git does not ignore ${resolved}`;
  return null;
}
