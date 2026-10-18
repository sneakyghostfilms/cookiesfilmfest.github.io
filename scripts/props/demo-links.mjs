import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEMO_URL = '/props-demo';
const ZOOM_PERCENT = 150;
const MARGIN_POINTS = 12;

export function readDemoManifest(directory = resolve('.props-demo')) {
  const file = join(directory, 'manifest.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

export function readPrivateVendors(directory = resolve('.props-private')) {
  const file = join(directory, 'vendors.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

export function privateVendorsFor(env, read = readPrivateVendors) {
  return env.PROPS_DEMO === '1' && env.PROPS_SHOW_PRIVATE === '1' ? read() : null;
}

const points = (value) => Math.round(value * 100) / 100;

export function pdfBox([x0, top, x1, bottom], pageHeight) {
  return { left: points(x0), top: points(pageHeight - top), right: points(x1), bottom: points(pageHeight - bottom) };
}

export function demoCatalogHref({ catalog, page, box }) {
  const left = Math.max(0, Math.floor(box.left - MARGIN_POINTS));
  const top = Math.ceil(box.top + MARGIN_POINTS);
  return `${DEMO_URL}/catalogs/${catalog}.pdf#page=${page}&zoom=${ZOOM_PERCENT},${left},${top}`;
}

export const DEMO_STYLES = `
.props-page .props-demo-marker { order: 3; flex-basis: 100%; margin: 0; font-size: 12px; color: var(--pp-muted); }
.props-page .props-demo-marker span { display: inline-block; padding: 2px 8px; border: 1px dashed var(--pp-muted); border-radius: 2px; }
.props-page .prop-thumb { display: block; width: 100%; height: auto; max-height: 200px; object-fit: contain; background-color: var(--pp-paper); border: 1px solid var(--pp-rule); border-radius: 2px; }
.props-page .prop-photo { font-size: 12px; color: var(--pp-muted); }
.props-page .props-vendor-private { margin-top: 8px; padding: 8px 12px; border: 1px dashed var(--pp-muted); border-radius: 2px; }
`;
