import { test as base, expect, type Page } from '@playwright/test';
import { GAME_OVER_GUARD_MS } from '../src/app/gameOverGuard';
import { SETTINGS_KEY } from '../src/app/settings';
import type { Look } from '../src/content/cosmetics';
import { GALAXIES } from '../src/content/galaxies';
import type { GalaxyId, PickupId } from '../src/content/types';
import { defaultSave, SAVE_KEY, type SaveData } from '../src/meta/save';
import { STEP_SECONDS } from '../src/sim/config';
import { BRIDGE_VERSION } from '../src/testBridge';
import { BOSS_GALAXY, E2E_GALAXY, GAME_OVER_GALAXY, seedFor } from './seeds';

/**
 * Fails every test that logs a console error or throws an uncaught page error.
 * The check runs in teardown, so it covers everything the test did. A spec that
 * provokes an error on purpose lists its message in `allowedErrors`; only messages
 * containing one of those strings are let through.
 */
export const test = base.extend<{ consoleErrors: string[]; allowedErrors: string[] }>({
  allowedErrors: [[], { option: true }],
  consoleErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });
      await use(errors);
      const unexpected = errors.filter((message) => !allowedErrors.some((allowed) => message.includes(allowed)));
      expect(unexpected, 'console and page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The toast: the one status region the player sees (the boss announcer is a visually hidden status region too). */
export const toastOf = (page: Page) => page.getByRole('status').and(page.locator('.toast'));

/** The title screen's build label in a `vite preview` build. */
export const BUILD_LABEL = /^preview · (local|[0-9a-f]{7}) · \d{4}-\d{2}-\d{2}$/;

/** The e2e-only URL overrides (see src/app/seed.ts). */
export interface GameQuery {
  readonly seed?: number;
  /** Makes the run a Rank run with these lives (1-5). */
  readonly lives?: number;
  /** A level index (0-3) or name to pin; without it the quality adapts to frame time. */
  readonly quality?: string;
  /** The galaxy the title's Play jumps straight into; null for the normal flow through mode select. */
  readonly galaxy?: string | null;
  /** Seconds into that galaxy at which a gravity storm is added to it (see src/app/seed.ts). */
  readonly storm?: number;
}

/**
 * Opens the e2e build (the 'lanes-clear' seed and galaxy E2E_GALAXY unless overridden) and waits for the test bridge, which
 * loads after an `import()`. Any of these switches makes it a debug run, which never writes the save.
 */
export async function openGame(page: Page, { seed = seedFor('lanes-clear'), lives, quality, galaxy = E2E_GALAXY, storm }: GameQuery = {}): Promise<void> {
  const query = new URLSearchParams({ seed: String(seed) });
  if (galaxy !== null) query.set('galaxy', galaxy);
  if (lives !== undefined) query.set('lives', String(lives));
  if (quality !== undefined) query.set('quality', quality);
  if (storm !== undefined) query.set('storm', String(storm));
  await page.goto(`/?${query.toString()}`);
  await waitForBridge(page);
}

/** Opens the e2e build with no switches: the normal flow, whose runs write the real save. */
export async function openFreshGame(page: Page): Promise<void> {
  await page.goto('/');
  await waitForBridge(page);
}

/** Waits for the test bridge, which loads after an `import()`; call it again after a reload. */
export async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction((version) => window.__COSMIC_ASSAULT_TEST_API__?.version === version, BRIDGE_VERSION);
}

/** Steps the run in play by `seconds` of sim time at once, stopping early if it leaves play. */
export function fastForward(page: Page, seconds: number): Promise<void> {
  return page.evaluate((s) => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    api.fastForward(s);
  }, seconds);
}

/**
 * Stores `text` under the save key before every navigation of `page`, as a returning player's browser would hold it;
 * with `once`, only before the first, so a reload finds what the game wrote since.
 */
export async function seedStorage(page: Page, text: string, { once = false } = {}): Promise<void> {
  await page.addInitScript(([key, value, onlyOnce]) => {
    if (onlyOnce) {
      if (sessionStorage.getItem('seeded') !== null) return;
      sessionStorage.setItem('seeded', '1');
    }
    localStorage.setItem(key, value);
  }, [SAVE_KEY, text, once] as const);
}

/** `seedStorage` for a save object. */
export function seedSave(page: Page, save: SaveData, options: { once?: boolean } = {}): Promise<void> {
  return seedStorage(page, JSON.stringify(save), options);
}

/** Three stars in every galaxy, which unlocks every look. */
export const ALL_STARS_SAVE: SaveData = {
  ...defaultSave(),
  galaxies: Object.fromEntries(GALAXIES.map(({ id }) => [id, { bestScore: 1000, stars: 3 }])),
};

/** Stores settings that choose `look`, before the page loads; the ship draws it only where the save's stars unlock it. */
export async function seedLook(page: Page, look: Look): Promise<void> {
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value);
  }, [SETTINGS_KEY, JSON.stringify(look)] as const);
}

/** The save as `localStorage` holds it, parsed; empty before anything is written. */
export async function storedSave(page: Page): Promise<Partial<SaveData>> {
  const text = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  return text === null ? {} : (JSON.parse(text) as Partial<SaveData>);
}

/** Title → Free play → Dimension `dimension`, as a player taps it; the galaxy select is showing on return. */
export async function openGalaxySelect(page: Page, dimension: number): Promise<void> {
  await page.getByTestId('play').click();
  await page.getByTestId('mode-free').click();
  await page.getByTestId(`dimension-${String(dimension)}`).click();
}

/** Title → Free play → the galaxy's Dimension → the galaxy; the run is in play on return. */
export async function playFreeGalaxy(page: Page, id: GalaxyId): Promise<void> {
  await openGalaxySelect(page, Number(id.slice(0, 1)));
  await page.getByTestId(`galaxy-${id}`).click();
  await expectMode(page, 'playing');
}

/** How long `clickPastGuard` keeps clicking: the guard several times over, for a slow host. */
const PAST_GUARD_TIMEOUT_MS = GAME_OVER_GUARD_MS * 10;

/**
 * Clicks (or, on a touch screen, taps) `testId` until the game reaches `screen`: an end card ignores input for
 * GAME_OVER_GUARD_MS after it opens, and a click it ignores changes nothing, so retrying needs no fixed wait. A click
 * can land just as its own timeout runs out, so each try first checks whether the last one already got there.
 */
export async function clickPastGuard(page: Page, testId: string, screen: CosmicAssaultTestState['screen'], press: 'click' | 'tap' = 'click'): Promise<void> {
  await expect(async () => {
    if ((await gameState(page)).screen !== screen) await page.getByTestId(testId)[press]({ timeout: 1000 });
    expect((await gameState(page)).screen).toBe(screen);
  }).toPass({ timeout: PAST_GUARD_TIMEOUT_MS });
}

/** Makes the time-based run seed `seed` for every navigation of `page`, without a debug switch, so the run still saves. */
export async function pinClockSeed(page: Page, seed: number): Promise<void> {
  await page.addInitScript((value) => {
    Date.now = () => value;
  }, seed);
}

/** Resolves after `count` more animation frames, each of which runs one app frame. */
export async function nextFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  }, count);
}

/** The bridge's state snapshot; only call it after `openGame`. */
export function gameState(page: Page): Promise<CosmicAssaultTestState> {
  return page.evaluate(() => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    return api.getState();
  });
}

/** Shots in the next volley: steps until the ship fires, then returns how many shots that one step added. The fire key must be held. */
export function shotsPerVolley(page: Page): Promise<number> {
  return page.evaluate((step) => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    // A volley comes every 0.32 s at most, so 0.5 s of steps always holds one.
    for (let waited = 0; waited < 0.5; waited += step) {
      const before = api.getState().events.shot ?? 0;
      api.fastForward(step);
      const added = (api.getState().events.shot ?? 0) - before;
      if (added > 0) return added;
    }
    throw new Error('The ship fired nothing in 0.5 s with fire held; hold the fire key before counting a volley');
  }, STEP_SECONDS);
}

/** Drops a pickup onto the ship at the next step (see `grantPickup` in src/testApi.d.ts); step once to collect it. */
export function grantPickup(page: Page, kind: PickupId): Promise<void> {
  return page.evaluate((k) => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    api.grantPickup(k);
  }, kind);
}

/** Restarts the frame stats, warm-up included (see `restartFrameStats` in src/testApi.d.ts). */
export function restartFrameStats(page: Page): Promise<void> {
  return page.evaluate(() => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    api.restartFrameStats();
  });
}

/** Lands `shots` shots on the boss where they do harm (see `damageBoss` in src/testApi.d.ts); the page throws if none can. */
export function damageBoss(page: Page, shots: number): Promise<void> {
  return page.evaluate((n) => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    api.damageBoss(n);
  }, shots);
}

/** The ship in the current run; fails if no run is in play (title and menu screens). */
export async function shipState(page: Page): Promise<CosmicAssaultTestShip> {
  const { ship } = await gameState(page);
  if (ship === null) throw new Error('No ship: the game is on the title screen; start a run first');
  return ship;
}

/** Waits for the game's `mode`; pass a longer `timeout` where a rendered frame has to apply the change first. */
export async function expectMode(page: Page, mode: CosmicAssaultTestState['mode'], { timeout }: { timeout?: number } = {}): Promise<void> {
  await expect.poll(async () => (await gameState(page)).mode, timeout === undefined ? {} : { timeout }).toBe(mode);
}

/** Starts the run the title shows: a tap on a phone, Space at a desk. */
export async function startRun(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
  else await page.keyboard.press('Space');
  await expectMode(page, 'playing');
}

export function speed({ vx, vy }: CosmicAssaultTestShip): number {
  return Math.hypot(vx, vy);
}

/** Opens a one-life Rank run of GAME_OVER_GALAXY and the 'one-life-death' seed; start it, then call `waitForGameOver`. */
export function openGameOverRun(page: Page): Promise<void> {
  return openGame(page, { seed: seedFor('one-life-death'), lives: 1, galaxy: GAME_OVER_GALAXY });
}

/**
 * Shots `damageBoss` lands to beat any boss: each goes where it does harm, so this must cover the shots that break a
 * shielded boss's parts as well as its HP. The Monolith's are up to `SHARD_COUNTS[1] - EXPOSED_AT` shards of `SHARD_HP`
 * before its core is bare, then its `bossHp`; the Leviathan's, its 8 segments of 3 HP, then the 16 HP their breaks
 * (`partBreakDamage` each) leave of its 40; the Eclipse's, its 10 shards of 2 HP, then its 80. A boss that falls first
 * ends the strikes early.
 */
export const KILL_SHOTS = 200;

/** Opens BOSS_GALAXY in Free play with the 'boss-fight' seed, whose idle ship lives to the boss fight. */
export function openBossGame(page: Page): Promise<void> {
  return openGame(page, { seed: seedFor('boss-fight'), galaxy: BOSS_GALAXY });
}

/** Waits for the idle ship's only life to go (about 7 s of sim time; a starved renderer runs slower). */
export async function waitForGameOver(page: Page): Promise<void> {
  await expect.poll(async () => (await gameState(page)).mode, { timeout: 20000 }).toBe('gameOver');
}

/** Deliberate wait: lets the game-over guard lapse so the card's inputs are live. */
export async function waitOutGameOverGuard(page: Page): Promise<void> {
  await page.waitForTimeout(GAME_OVER_GUARD_MS + 100);
}
