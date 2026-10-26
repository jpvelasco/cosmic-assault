import { test as base, expect, type Page } from '@playwright/test';
import { GAME_OVER_GUARD_MS } from '../src/app/gameOverGuard';
import type { GalaxyId } from '../src/content/types';
import { SAVE_KEY, type SaveData } from '../src/meta/save';
import { E2E_GALAXY, E2E_SEED, GAME_OVER_GALAXY, GAME_OVER_SEED } from './seed';

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
}

/**
 * Opens the e2e build (seed E2E_SEED and galaxy E2E_GALAXY unless overridden) and waits for the test bridge, which
 * loads after an `import()`. Any of these switches makes it a debug run, which never writes the save.
 */
export async function openGame(page: Page, { seed = E2E_SEED, lives, quality, galaxy = E2E_GALAXY }: GameQuery = {}): Promise<void> {
  const query = new URLSearchParams({ seed: String(seed) });
  if (galaxy !== null) query.set('galaxy', galaxy);
  if (lives !== undefined) query.set('lives', String(lives));
  if (quality !== undefined) query.set('quality', quality);
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
  await page.waitForFunction(() => window.__COSMIC_ASSAULT_TEST_API__?.version === 3);
}

/** Steps the run in play by `seconds` of sim time at once, stopping early if it leaves play. */
export function fastForward(page: Page, seconds: number): Promise<void> {
  return page.evaluate((s) => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    api.fastForward(s);
  }, seconds);
}

/** Stores `save` under the save key before every navigation of `page`, as a returning player's browser would hold it. */
export async function seedSave(page: Page, save: SaveData): Promise<void> {
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value);
  }, [SAVE_KEY, JSON.stringify(save)] as const);
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
 * Clicks `testId` until the game reaches `screen`: an end card ignores input for GAME_OVER_GUARD_MS after it opens,
 * and a click it ignores changes nothing, so retrying needs no fixed wait. A click can land just as its own timeout
 * runs out, so each try first checks whether the last one already got there.
 */
export async function clickPastGuard(page: Page, testId: string, screen: CosmicAssaultTestState['screen']): Promise<void> {
  await expect(async () => {
    if ((await gameState(page)).screen !== screen) await page.getByTestId(testId).click({ timeout: 1000 });
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

/** The ship in the current run; fails if no run is in play (title and menu screens). */
export async function shipState(page: Page): Promise<CosmicAssaultTestShip> {
  const { ship } = await gameState(page);
  if (ship === null) throw new Error('No ship: the game is on the title screen; start a run first');
  return ship;
}

export async function expectMode(page: Page, mode: CosmicAssaultTestState['mode']): Promise<void> {
  await expect.poll(async () => (await gameState(page)).mode).toBe(mode);
}

export function speed({ vx, vy }: CosmicAssaultTestShip): number {
  return Math.hypot(vx, vy);
}

/** Opens a one-life Rank run of GAME_OVER_GALAXY and GAME_OVER_SEED; start it, then call `waitForGameOver`. */
export function openGameOverRun(page: Page): Promise<void> {
  return openGame(page, { seed: GAME_OVER_SEED, lives: 1, galaxy: GAME_OVER_GALAXY });
}

/** Waits for the idle ship's only life to go (about 7 s of sim time; a starved renderer runs slower). */
export async function waitForGameOver(page: Page): Promise<void> {
  await expect.poll(async () => (await gameState(page)).mode, { timeout: 20000 }).toBe('gameOver');
}

/** Deliberate wait: lets the game-over guard lapse so the card's inputs are live. */
export async function waitOutGameOverGuard(page: Page): Promise<void> {
  await page.waitForTimeout(GAME_OVER_GUARD_MS + 100);
}
