import { createReadStream, statSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import exclusions from './demo-exclusions.json' with { type: 'json' };

const TYPES = { '.webp': 'image/webp', '.pdf': 'application/pdf' };
export const DEMO_EXCLUDED_KEYS = new Set(Object.keys(exclusions).map((key) => key.toLowerCase()));

export function demoAssetHandler(directory, excludedKeys = DEMO_EXCLUDED_KEYS) {
  const base = resolve(directory);
  return (req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return next();
    }
    const file = resolve(base, `.${pathname}`);
    if (excludedKeys.has(basename(file, extname(file)).toLowerCase())) return next();
    const type = TYPES[extname(file).toLowerCase()];
    const stats = type && file.startsWith(`${base}${sep}`) ? statSync(file, { throwIfNoEntry: false }) : null;
    if (!stats?.isFile()) return next();
    res.setHeader('content-type', type);
    res.setHeader('content-length', stats.size);
    res.setHeader('cache-control', 'no-store');
    createReadStream(file).pipe(res);
  };
}

export function propsDemo(directory, env = process.env) {
  return {
    name: 'props-demo',
    hooks: {
      'astro:config:setup': ({ command, updateConfig }) => {
        if (env.PROPS_DEMO !== '1') return;
        if (command === 'build') {
          throw new Error('PROPS_DEMO=1 is for the local demo dev server only. Unset it to build, so vendor photos and PDFs can never reach dist/.');
        }
        if (command !== 'dev') return;
        updateConfig({
          devToolbar: { enabled: false },
          vite: {
            server: { strictPort: true },
            plugins: [{
              name: 'props-demo-assets',
              configureServer(server) {
                server.middlewares.use('/props-demo', demoAssetHandler(directory));
              },
            }],
          },
        });
      },
    },
  };
}
