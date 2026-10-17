import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const VENDORS_FILE = join(ROOT, 'src/data/props/vendors.json');
const EXTRACTOR = join(ROOT, 'scripts/props/extract_catalog.py');

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function findCatalog(vendors, digest) {
  for (const vendor of vendors.vendors) {
    const catalog = vendor.catalogs.find((entry) => entry.sha256 === digest);
    if (catalog) return { vendor, catalog };
  }
  return null;
}

export function extractCatalog(pdf, { pages, sheetsDir } = {}) {
  const args = ['-I', '-B', EXTRACTOR, pdf];
  if (pages) args.push('--pages', pages);
  if (sheetsDir) args.push('--sheets-dir', sheetsDir);
  const run = spawnSync('python3', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new Error(`Could not run python3: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`Extractor failed (exit ${run.status}):\n${run.stderr}`);
  return JSON.parse(run.stdout);
}
