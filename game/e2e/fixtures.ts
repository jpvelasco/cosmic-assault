import { test as base, expect, type Page } from '@playwright/test';

/**
 * Fails every test that logs a console error or throws an uncaught page error.
 * The check runs in teardown, so it covers everything the test did.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });
      await use(errors);
      expect(errors, 'console and page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The title screen's build label in a `vite preview` build. */
export const BUILD_LABEL = /^preview · (local|[0-9a-f]{7}) · \d{4}-\d{2}-\d{2}$/;

/** A seed whose practice asteroids stay clear of the ship's firing lanes for the specs' first seconds. */
const SEED = 4;

/** Opens the e2e build with a fixed seed and waits for the test bridge, which loads after an `import()`. */
export async function openGame(page: Page): Promise<void> {
  await page.goto(`/?seed=${String(SEED)}`);
  await page.waitForFunction(() => window.__COSMIC_ASSAULT_TEST_API__?.version === 3);
}

/** The bridge's state snapshot; only call it after `openGame`. */
export function gameState(page: Page): Promise<CosmicAssaultTestState> {
  return page.evaluate(() => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    return api.getState();
  });
}

/** The ship in the current run; fails if the game is on the title screen. */
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
