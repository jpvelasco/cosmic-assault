// Rasterizes assets-src/icon.svg into the app icons in public/icons/ with Playwright's Chromium.
// Usage: npm run icons [-- --preview <dir>]  (the preview also writes a 48 px icon and the maskable one under a circle mask)
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const SOURCE = readFileSync(new URL('../assets-src/icon.svg', import.meta.url), 'utf8');
const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));

/**
 * `reach` is the radius, as a fraction of the size, that the ship's outline (hull and flame) is scaled to fill.
 * Rounded icons keep their own transparent corners; full-bleed ones are squared for the platform to mask. The
 * maskable mark stays well inside the 80 % safe circle (radius 0.4), leaving room for its rim and blurred flame.
 */
const ANY = { rounded: true, reach: 0.44 };
const FULL_BLEED = { rounded: false, reach: 0.44 };
const MASKABLE = { rounded: false, reach: 0.36 };
const MASKABLE_SAFE_RADIUS = 0.4;

const ICONS = [
  { file: 'icon-192.png', size: 192, ...ANY },
  { file: 'icon-512.png', size: 512, ...ANY },
  { file: 'icon-maskable-512.png', size: 512, ...MASKABLE },
  // iOS rounds the corners itself and shows transparency as black.
  { file: 'apple-touch-icon.png', size: 180, ...FULL_BLEED },
];

/** Squares the backdrop if asked, and scales the mark about the centre until its outline reaches `reach`. False if it has no outline. */
function fitMark({ rounded, reach }) {
  const svg = document.querySelector('svg');
  if (!rounded) svg.querySelector('#backdrop').setAttribute('rx', '0');
  const box = svg.viewBox.baseVal;
  const centre = box.width / 2;
  const mark = svg.querySelector('#mark');
  const extent = () => {
    let far = 0;
    for (const shape of svg.querySelectorAll('.extent')) {
      // Into the viewBox's units: the mark's own transform is included, the viewport's scaling is not.
      const toViewBox = svg.getScreenCTM().inverse().multiply(shape.getScreenCTM());
      for (const point of shape.points) {
        const p = point.matrixTransform(toViewBox);
        far = Math.max(far, Math.hypot(p.x - centre, p.y - centre));
      }
    }
    return far / box.width;
  };
  const natural = extent();
  if (!(natural > 0)) return false;
  mark.setAttribute('transform', `translate(${centre} ${centre}) scale(${reach / natural}) translate(${-centre} ${-centre})`);
  return true;
}

async function render(page, { size, rounded, reach }, path, mask = '') {
  await page.setViewportSize({ width: size, height: size });
  const svg = SOURCE.replace('width="512" height="512"', `width="${size}" height="${size}" style="display:block"`);
  const clip = mask ? 'clip-path:circle(50%)' : '';
  await page.setContent(`<!doctype html><body style="margin:0">${mask}<div style="${clip}">${svg}</div></body>`);
  if (!(await page.evaluate(fitMark, { rounded, reach }))) {
    throw new Error('assets-src/icon.svg has no .extent shapes inside #mark; mark the hull and flame outlines with class="extent"');
  }
  await page.screenshot({ path, omitBackground: true });
  console.log(`${path} (${size} px)`);
}

/** The safe zone drawn as a dashed ring over the circle-masked maskable icon. */
const SAFE_RING = `<div style="position:fixed;inset:${(50 - MASKABLE_SAFE_RADIUS * 100).toFixed(0)}%;border:2px dashed #fff8;border-radius:50%;z-index:1"></div>`;

const { values } = parseArgs({ options: { preview: { type: 'string' } } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await mkdir(OUT_DIR, { recursive: true });
  for (const icon of ICONS) await render(page, icon, join(OUT_DIR, icon.file));
  if (values.preview !== undefined) {
    await mkdir(values.preview, { recursive: true });
    await render(page, { size: 48, ...ANY }, join(values.preview, 'm3-icon-48.png'));
    await render(page, { size: 192, ...ANY }, join(values.preview, 'm3-icon-192.png'));
    await render(page, { size: 512, ...MASKABLE }, join(values.preview, 'm3-icon-maskable-preview.png'), SAFE_RING);
  }
} finally {
  await browser.close();
}
