// Browser staging shared by the scripts that shoot the game: the README stills (readme-shots.mjs) and the contact sheet
// of every sky (backdrop-sheet.mjs). Each builds the e2e build, serves it, and drives its pages through the e2e URL
// overrides and the test bridge.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAME_DIR = fileURLToPath(new URL('..', import.meta.url));
const DIST_E2E = join(GAME_DIR, 'dist-e2e');

/** Runs `npm run build:e2e` in game/, through the npm that runs this script when there is one. */
function buildE2e() {
  const npm = process.env['npm_execpath'];
  const [command, args] = npm === undefined ? ['npm', []] : [process.execPath, [npm]];
  execFileSync(command, [...args, 'run', 'build:e2e'], { cwd: GAME_DIR, stdio: 'inherit' });
}

/**
 * The e2e build's query string for `overrides`, in their order with the undefined ones left out, and the top quality
 * level pinned so every capture draws alike.
 */
export function e2eQuery(overrides) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) query.set(key, String(value));
  }
  query.set('quality', 'high');
  return query.toString();
}

/**
 * Builds the e2e build (unless `skipBuild`), serves it, launches Chromium, and hands `use` the browser, the device
 * presets and the served address; all three are closed when `use` returns or throws.
 */
export async function withE2eBrowser({ skipBuild }, use) {
  if (!skipBuild) buildE2e();
  if (!existsSync(join(DIST_E2E, 'index.html'))) throw new Error(`${DIST_E2E} holds no build; run npm run build:e2e, or drop --skip-build`);
  const { chromium, devices } = await import('@playwright/test');
  const { createPagesServer } = await import('./serve-pages.mjs');
  const server = await createPagesServer({ mounts: [{ dir: DIST_E2E, at: './' }] });
  const browser = await chromium.launch();
  try {
    return await use({ browser, devices, url: server.url });
  } finally {
    await browser.close();
    await server.close();
  }
}

/** The browser context a capture runs in: the desktop field, or a Pixel 5 in landscape at 2x, with no service worker. */
export function contextOptions(device, devices) {
  const common = { serviceWorkers: 'block', reducedMotion: 'no-preference' };
  if (device === 'phone') return { ...devices['Pixel 5 landscape'], deviceScaleFactor: 2, ...common };
  return { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...common };
}

/** Waits for the e2e build's test bridge, which loads after an import(). */
export async function waitForBridge(page) {
  await page.waitForFunction(() => typeof window.__COSMIC_ASSAULT_TEST_API__?.getState === 'function', undefined, { timeout: 30_000 });
}

/** Waits for the run to be in play. */
export function waitForPlaying(page) {
  return page.waitForFunction(() => window.__COSMIC_ASSAULT_TEST_API__?.getState().screen === 'playing', undefined, { timeout: 10_000 });
}

/** Presses Space on the title, which starts the galaxy a `?galaxy=` page opened on, and waits for the run to be in play. */
export async function startRunFromTitle(page) {
  await page.keyboard.press('Space');
  await waitForPlaying(page);
}
