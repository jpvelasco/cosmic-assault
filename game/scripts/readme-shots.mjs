// Renders the README's stills into docs/assets/screens/ with Playwright's Chromium, from the e2e build.
// Usage: npm run readme-shots [-- --skip-build] [-- --out <dir>]
//
// It builds dist-e2e/ (unless --skip-build), serves it, stages each scene through the e2e build's URL overrides and test
// bridge, and writes one PNG per entry of SHOTS. A still over SHOT_BYTE_CAP is scaled down until it fits. Run it after
// a visible change to the title, a palette, the HUD or a boss, and commit the PNGs.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const GAME_DIR = fileURLToPath(new URL('..', import.meta.url));
const DIST_E2E = join(GAME_DIR, 'dist-e2e');
/** Where the README links its stills from: docs/assets/screens/ at the repository root. */
export const SHOTS_DIR = fileURLToPath(new URL('../../docs/assets/screens/', import.meta.url));

/** The most bytes one still may take, so the README stays light to load. */
export const SHOT_BYTE_CAP = 250 * 1024;

/** Widths a still that is over the cap is scaled down to, in turn, until one fits. */
const FIT_WIDTHS = [1600, 1280, 1120, 960, 800, 640];

/** Sim seconds a scene may take to reach its moment before the script gives up on its seed. */
const MAX_SCENE_SECONDS = 90;
/** Sim seconds stepped at a time while a scene is looked for. */
const SCENE_STEP_SECONDS = 0.25;
/** Real milliseconds of play after the scene is reached, so shots, particles and the HUD are on screen. */
const SETTLE_MS = 700;

/**
 * Every still the README shows, each `file` linked from ReadMe.md under that name. `scene` is the moment shot: the
 * attract demo behind the title, or in `galaxy` a hazard of type `hazard` turned hostile, or the boss fighting, then
 * `after` more sim seconds. The ship idles to that moment, then fires and turns for SETTLE_MS. `claim` names the e2e
 * seed (e2e/seeds.ts) whose idle ship is vouched to live to the moment, which tests/unit/readmeShots.test.ts holds
 * `seed` and `galaxy` to; `lives` (which makes it a Rank run) matches the claim's run, but for the phone, whose field the
 * claim does not cover, where it buys slack.
 */
export const SHOTS = [
  { file: 'title.png', device: 'desktop', scene: { kind: 'attract' } },
  {
    file: 'crimson-nebula.png',
    device: 'desktop',
    claim: 'crimson-hazards',
    galaxy: '3-4',
    seed: 176,
    lives: 5,
    scene: { kind: 'hazard', hazard: 'dangerZone', after: 1.5 },
  },
  {
    file: 'boss-leviathan.png',
    device: 'desktop',
    claim: 'leviathan-fight',
    galaxy: '4-6',
    seed: 1,
    scene: { kind: 'boss', after: 2 },
  },
  {
    file: 'phone-landscape.png',
    device: 'phone',
    claim: 'ion-reach-hazards',
    galaxy: '2-4',
    seed: 12,
    lives: 5,
    scene: { kind: 'hazard', hazard: 'gravityWell', after: 1 },
  },
];

/** The e2e build's query string for `shot`: its seed, galaxy and lives if it plays a galaxy, and the top quality level. */
export function shotQuery({ seed, galaxy, lives }) {
  const query = new URLSearchParams();
  if (seed !== undefined) query.set('seed', String(seed));
  if (galaxy !== undefined) query.set('galaxy', galaxy);
  if (lives !== undefined) query.set('lives', String(lives));
  query.set('quality', 'high');
  return query.toString();
}

/** The widths to try for a still `native` pixels wide: its own, then each smaller width of FIT_WIDTHS. */
export function candidateWidths(native) {
  return [native, ...FIT_WIDTHS.filter((width) => width < native)];
}

/** Waits for the e2e build's test bridge, which loads after an import(). */
async function waitForBridge(page) {
  await page.waitForFunction(() => typeof window.__COSMIC_ASSAULT_TEST_API__?.getState === 'function', undefined, { timeout: 30_000 });
}

/** Starts the attract demo behind the title and lets it play a while; the bare title is shot if it never starts. */
async function stageAttract(page) {
  await page.evaluate(() => {
    window.__COSMIC_ASSAULT_TEST_API__?.attractNow();
  });
  try {
    await page.waitForFunction(() => (window.__COSMIC_ASSAULT_TEST_API__?.getState().attract?.frames ?? 0) > 150, undefined, { timeout: 15_000 });
  } catch {
    console.warn('title.png: the attract demo did not start within 15 s; shooting the bare title instead');
  }
}

/** Steps the idle run until `scene` is reached, then `scene.after` more seconds. Undefined when reached, else why not. */
function stepToScene(page, scene) {
  return page.evaluate(
    ({ scene: wanted, maxSeconds, step }) => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      if (api === undefined) return 'the test bridge is missing';
      const reached = (state) =>
        wanted.kind === 'boss' ? state.boss?.state === 'fighting' : state.hazards.some(({ type, stage }) => type === wanted.hazard && stage === 'active');
      for (let seconds = 0; seconds <= maxSeconds; seconds += step) {
        const state = api.getState();
        if (state.screen !== 'playing') return `the run left play (${state.screen}) after ${String(seconds)} s`;
        if (reached(state)) {
          api.fastForward(wanted.after);
          const after = api.getState().screen;
          return after === 'playing' ? undefined : `the run left play (${after}) just after the moment`;
        }
        api.fastForward(step);
      }
      return `it never came within ${String(maxSeconds)} s`;
    },
    { scene, maxSeconds: MAX_SCENE_SECONDS, step: SCENE_STEP_SECONDS },
  );
}

/** Starts the shot's galaxy from the title and steps the idle ship to its moment, then holds fire and a left turn; throws if the moment never comes. */
async function stageGalaxy(page, shot) {
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__COSMIC_ASSAULT_TEST_API__?.getState().screen === 'playing', undefined, { timeout: 10_000 });
  const missed = await stepToScene(page, shot.scene);
  if (missed !== undefined) {
    throw new Error(
      `${shot.file}: seed ${String(shot.seed)} in ${shot.galaxy} missed its moment: ${missed}. Its seed is the e2e seed of the '${shot.claim}' claim in e2e/seeds.ts: if that seed has changed, copy the new one into SHOTS (scripts/readme-shots.mjs); otherwise drop the claim from the shot and give it a seed that reaches the moment`,
    );
  }
  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowLeft');
}

/** The page's look, as PNG bytes, once the scene has played SETTLE_MS in real time. */
async function capture(page) {
  await page.waitForTimeout(SETTLE_MS);
  return page.screenshot({ type: 'png' });
}

/** `png` drawn `width` pixels wide on a canvas in `scratch`, re-encoded as PNG. */
async function scaledTo(scratch, png, width) {
  const data = await scratch.evaluate(
    async ({ source, wide }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = wide;
      canvas.height = Math.round((image.height * wide) / image.width);
      const pen = canvas.getContext('2d');
      pen.imageSmoothingQuality = 'high';
      pen.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { source: png.toString('base64'), wide: width },
  );
  return Buffer.from(data, 'base64');
}

/** `png`, or the widest scaled copy of it that fits SHOT_BYTE_CAP; throws if even the narrowest does not. */
async function fitted(scratch, png, file) {
  const native = png.readUInt32BE(16);
  let candidate = png;
  for (const width of candidateWidths(native)) {
    if (width !== native) candidate = await scaledTo(scratch, png, width);
    if (candidate.length <= SHOT_BYTE_CAP) return { png: candidate, width };
  }
  throw new Error(
    `${file} is still ${String(Math.ceil(candidate.length / 1024))} KB at its narrowest (${String(FIT_WIDTHS.at(-1))} px), over the ${String(SHOT_BYTE_CAP / 1024)} KB cap; shoot a calmer moment or add a narrower width to FIT_WIDTHS`,
  );
}

/** The browser context each device shoots in: the e2e projects' desktop and phone, with no service worker. */
function contextOptions(device, devices) {
  const common = { serviceWorkers: 'block', reducedMotion: 'no-preference' };
  if (device === 'phone') return { ...devices['Pixel 5 landscape'], deviceScaleFactor: 2, ...common };
  return { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...common };
}

async function shoot(browser, devices, scratch, url, shot, outDir) {
  const context = await browser.newContext(contextOptions(shot.device, devices));
  try {
    const page = await context.newPage();
    await page.goto(`${url}?${shotQuery(shot)}`);
    await waitForBridge(page);
    if (shot.scene.kind === 'attract') await stageAttract(page);
    else await stageGalaxy(page, shot);
    const { png, width } = await fitted(scratch, await capture(page), shot.file);
    const path = join(outDir, shot.file);
    await writeFile(path, png);
    console.log(`${path} (${String(width)} px wide, ${String(Math.ceil(png.length / 1024))} KB)`);
  } finally {
    await context.close();
  }
}

/** Runs `npm run build:e2e` in game/, through the npm that runs this script when there is one. */
function buildE2e() {
  const npm = process.env['npm_execpath'];
  const [command, args] = npm === undefined ? ['npm', []] : [process.execPath, [npm]];
  execFileSync(command, [...args, 'run', 'build:e2e'], { cwd: GAME_DIR, stdio: 'inherit' });
}

async function main() {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false }, out: { type: 'string' } } });
  const outDir = resolve(values.out ?? SHOTS_DIR);
  if (!values['skip-build']) buildE2e();
  if (!existsSync(join(DIST_E2E, 'index.html'))) throw new Error(`${DIST_E2E} holds no build; run npm run build:e2e, or drop --skip-build`);
  const { chromium, devices } = await import('@playwright/test');
  const { createPagesServer } = await import('./serve-pages.mjs');
  const server = await createPagesServer({ mounts: [{ dir: DIST_E2E, at: './' }] });
  const browser = await chromium.launch();
  try {
    await mkdir(outDir, { recursive: true });
    const scratch = await browser.newPage();
    for (const shot of SHOTS) await shoot(browser, devices, scratch, server.url, shot, outDir);
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
