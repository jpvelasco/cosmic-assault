import type { Page } from '@playwright/test';
import { GAME_OVER_GUARD_MS } from '../src/app/gameOverGuard';
import { RANK_START_LIVES } from '../src/meta/rankRun';
import {
  expect,
  expectMode,
  fastForward,
  gameState,
  nextFrames,
  openGame,
  openGameOverRun,
  test,
  waitForGameOver,
  waitOutGameOverGuard,
} from './fixtures';
import { FREE_GAME_OVER_SECONDS, GAME_OVER_GALAXY, seedFor } from './seeds';

/** Starts the one-life Rank run of the game-over galaxy; its game over card offers Continue and Title. */
async function startOneLifeRun(page: Page): Promise<void> {
  await openGameOverRun(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  expect((await gameState(page)).lives).toBe(1);
}

/** Continue replays the galaxy with fresh lives, the score reset and the run marked. */
async function expectContinued(page: Page): Promise<void> {
  await expectMode(page, 'playing');
  const { lives, rankRun, score } = await gameState(page);
  expect({ lives, score }).toEqual({ lives: RANK_START_LIVES, score: 0 });
  expect(rankRun).toMatchObject({ score: 0, lives: RANK_START_LIVES, continued: true });
}

/**
 * Presses R (keydown and keyup) in the same frame the card opens, from inside the page, so the
 * press lands well within the guard however slowly the test process polls.
 */
function pressRAsTheCardOpens(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const watch = (): void => {
          if (window.__COSMIC_ASSAULT_TEST_API__?.getState().mode === 'gameOver') {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR' }));
            resolve();
          } else {
            requestAnimationFrame(watch);
          }
        };
        watch();
      }),
  );
}

test('R is ignored while the card opens and continues the run once the guard lapses', async ({ page }) => {
  await startOneLifeRun(page);

  await pressRAsTheCardOpens(page);
  await nextFrames(page, 3);
  expect((await gameState(page)).mode).toBe('gameOver');

  await waitOutGameOverGuard(page);
  await page.keyboard.press('KeyR');
  await expectContinued(page);
});

test('a click on the card outside its buttons does not restart', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);

  await page.mouse.click(20, 20);
  await nextFrames(page, 3);

  expect((await gameState(page)).mode).toBe('gameOver');
  await expect(page.getByText(/^Score \d+$/)).toBeVisible();
});

test('Continue on the card continues the run', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);

  await page.getByTestId('rank-continue').click();
  await expectContinued(page);
});

test('Title ends the run and returns to the title, where Play starts a fresh one', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);
  await expect(page.getByTestId('rank-continue')).toBeVisible();

  await page.getByTestId('rank-title').click();
  await expectMode(page, 'title');
  expect((await gameState(page)).rankRun).toBeNull();
  await page.keyboard.press('Space');

  await expectMode(page, 'playing');
  const { lives, rankRun } = await gameState(page);
  expect(lives).toBe(1);
  expect(rankRun).toMatchObject({ score: 0, lives: 1, continued: false });
});

test('a fire key held through the restart does not fire until pressed again', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);

  await page.keyboard.down('Space');
  await waitOutGameOverGuard(page);
  await page.keyboard.press('KeyR');
  await expectMode(page, 'playing');
  // Deliberate wait: the assertion is that the held key fires nothing during it.
  await page.waitForTimeout(500);
  expect((await gameState(page)).projectileCount).toBe(0);

  await page.keyboard.up('Space');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await gameState(page)).projectileCount).toBeGreaterThan(0);
  await page.keyboard.up('Space');
});

test('a Free play game over offers Retry, which plays the galaxy again at once, and Map', async ({ page }) => {
  // Three lives in 5-5: the 'free-game-over' seed's idle ship loses its last about 17 s in, so the test fast-forwards there.
  await openGame(page, { galaxy: GAME_OVER_GALAXY, seed: seedFor('free-game-over') });
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await fastForward(page, FREE_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await expect(page.getByTestId('rank-continue')).toBeHidden();
  await waitOutGameOverGuard(page);

  await page.getByTestId('results-retry').click();
  await expectMode(page, 'playing');
  expect(await gameState(page)).toMatchObject({ galaxy: '5-5', lives: 3, rankRun: null });

  await fastForward(page, FREE_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await waitOutGameOverGuard(page);
  await page.getByTestId('results-map').click();
  await expectMode(page, 'map');
});

/** Fast-forward steps of a second allowed before a Free run is down to its last life. */
const FREE_LIFE_STEPS_LIMIT = 120;

/** Death to play must stay under this: from the last life going to the next run's first play, in page time. */
const DEATH_TO_PLAY_BUDGET_MS = 2000;

/**
 * Slack on the guard's floor: the card's stamp comes a frame or so after the guard's own start, so a play this much
 * under GAME_OVER_GUARD_MS would mean the guard did not hold.
 */
const GUARD_SLACK_MS = 100;

/** The page's stamps, in `performance.now()` time, from animation frames; each is at most a frame or so late. */
interface DeathWatch {
  /** When the end card opened, which is the frame the last life went in. */
  cardAt: number | null;
  /** When the next run first played. */
  playAt: number | null;
}

declare global {
  interface Window {
    __caDeathWatch?: DeathWatch;
  }
}

/** Stamps, from the page's own frames, when the end card opens and when the next run first plays. */
function watchDeath(page: Page): Promise<void> {
  return page.evaluate(() => {
    const api = window.__COSMIC_ASSAULT_TEST_API__;
    if (api === undefined) throw new Error('Test bridge missing; open the e2e build with openGame() first');
    const watch: DeathWatch = { cardAt: null, playAt: null };
    window.__caDeathWatch = watch;
    const stamp = (): void => {
      const { mode } = api.getState();
      if (watch.cardAt === null) {
        if (mode === 'gameOver') watch.cardAt = performance.now();
      } else if (mode === 'playing') {
        watch.playAt = performance.now();
        return;
      }
      requestAnimationFrame(stamp);
    };
    requestAnimationFrame(stamp);
  });
}

/** How long presses may go on before the next run must have played. */
const PRESS_TIMEOUT_MS = 20000;

/** Whether the page has stamped the next run's first play. */
function playedInPage(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof window.__caDeathWatch?.playAt === 'number');
}

/**
 * Presses `press` from before the card until the next run plays. In play a press does nothing, and inside the guard it
 * changes nothing, so the press that plays is the first one the guard lets through. Starting before the card keeps the
 * test driver's round trip out of the measured path: a guard that did not hold would show as a play right after the card.
 */
async function pressUntilPlays(page: Page, press: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + PRESS_TIMEOUT_MS;
  while (!(await playedInPage(page))) {
    if (Date.now() > deadline) throw new Error('The next run never played: no press started it, so the end card or its guard is stuck');
    await press();
  }
}

/**
 * The death path from the card: presses `press` until the next run plays, then returns the page time from the card's
 * opening to that play. It must be under DEATH_TO_PLAY_BUDGET_MS, and not under the guard: a play sooner would mean it
 * did not hold. The time includes the test driver's own input latency, which the page cannot separate out.
 */
async function dieThenPress(page: Page, press: () => Promise<void>): Promise<number> {
  await pressUntilPlays(page, press);
  const ms = await page.evaluate(() => {
    const { cardAt, playAt } = window.__caDeathWatch ?? { cardAt: null, playAt: null };
    if (cardAt === null || playAt === null) throw new Error('The death watch saw no card or no play');
    return playAt - cardAt;
  });
  expect(ms, 'the guard holds').toBeGreaterThanOrEqual(GAME_OVER_GUARD_MS - GUARD_SLACK_MS);
  expect(ms, 'death to play').toBeLessThan(DEATH_TO_PLAY_BUDGET_MS);
  return ms;
}

/**
 * Opens the Free game-over galaxy with a run in play and the death watch on, then fast-forwards until one life is left, so
 * the last life goes in real frames, where the watch can see it.
 */
async function startFreeRunNearGameOver(page: Page): Promise<void> {
  await openGame(page, { seed: seedFor('free-game-over'), galaxy: GAME_OVER_GALAXY });
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await watchDeath(page);
  for (let steps = 0; steps < FREE_LIFE_STEPS_LIMIT && (await gameState(page)).lives > 1; steps++) await fastForward(page, 1);
  expect(await gameState(page)).toMatchObject({ mode: 'playing', lives: 1 });
}

test('R plays the Free galaxy again within the death budget, once the guard lapses', async ({ page }, testInfo) => {
  await startFreeRunNearGameOver(page);
  const ms = await dieThenPress(page, () => page.keyboard.press('KeyR'));
  testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
  expect(await gameState(page)).toMatchObject({ galaxy: GAME_OVER_GALAXY, lives: 3, rankRun: null });
});

test('Enter plays the Free galaxy again within the death budget', async ({ page }, testInfo) => {
  await startFreeRunNearGameOver(page);
  const ms = await dieThenPress(page, () => page.keyboard.press('Enter'));
  testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
});

test('Enter continues a Rank run within the death budget, once the guard lapses', async ({ page }, testInfo) => {
  await startOneLifeRun(page);
  await watchDeath(page);
  const ms = await dieThenPress(page, () => page.keyboard.press('Enter'));
  testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
  expect(await gameState(page)).toMatchObject({ lives: RANK_START_LIVES, rankRun: { continued: true } });
});

test.describe('tapped', () => {
  test.use({ hasTouch: true });

  test('a tap on Continue continues a Rank run within the death budget', async ({ page }, testInfo) => {
    await startOneLifeRun(page);
    await watchDeath(page);
    const ms = await dieThenPress(page, () => page.getByTestId('rank-continue').tap({ timeout: PRESS_TIMEOUT_MS }));
    testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
    await expectContinued(page);
  });
});
