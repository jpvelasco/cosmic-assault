import { test as base, expect, type Page } from '@playwright/test';
import { GAME_OVER_GUARD_MS } from '../src/app/gameOverGuard';
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
  await page.waitForFunction(() => window.__COSMIC_ASSAULT_TEST_API__?.version === 3);
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
