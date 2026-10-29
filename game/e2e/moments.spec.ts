import type { Page } from '@playwright/test';
import { GAME_OVER_GUARD_MS } from '../src/app/gameOverGuard';
import { RANK_START_LIVES, startRank } from '../src/meta/rankRun';
import { defaultSave, type SaveData } from '../src/meta/save';
import {
  expect,
  expectContinued,
  expectMode,
  fastForward,
  gameState,
  openDaily,
  openFreshGame,
  openGame,
  pinClockSeed,
  playDaily,
  playFreeGalaxy,
  seedSave,
  startOneLifeRun,
  storedSave,
  test,
} from './fixtures';
import { CLEAR_1_1_SECONDS, DAILY_CLEAR_SECONDS, dateFor, GAME_OVER_GALAXY, PHONE_VIEWPORT, seedFor } from './seeds';

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

/**
 * Whether the next run plays: the card has opened and the game is in play now. This reads the game's mode at once rather
 * than waiting on the watch's `playAt`, because a tap on Continue starts the run inside its click, a frame before the
 * watch stamps it. A loop that checked the stamp would tap again in play, and that tap would wait for the next run's
 * game over card and land inside its guard, leaving the run on the card.
 */
function playsInPage(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof window.__caDeathWatch?.cardAt === 'number' && window.__COSMIC_ASSAULT_TEST_API__?.getState().mode === 'playing');
}

/** A press of the key or button that plays again; false when there was nothing to press yet (a button not shown). */
type Press = () => Promise<boolean>;

/** When a press went in, in page time: after `from` and before `to`. */
interface PressSpan {
  readonly from: number;
  readonly to: number;
}

const pageNow = (page: Page): Promise<number> => page.evaluate(() => performance.now());

/**
 * Presses `press` from before the card until the next run plays, returning when each press went in. In play a press
 * does nothing, and inside the guard it changes nothing, so the press that plays is the first one the guard lets
 * through. Starting before the card keeps the test driver's round trip out of the measured path: a guard that did not
 * hold would show as a play right after the card.
 */
async function pressUntilPlays(page: Page, press: Press): Promise<PressSpan[]> {
  const spans: PressSpan[] = [];
  const deadline = Date.now() + PRESS_TIMEOUT_MS;
  while (!(await playsInPage(page))) {
    if (Date.now() > deadline) throw new Error('The next run never played: no press started it, so the end card or its guard is stuck');
    const from = await pageNow(page);
    if (await press()) spans.push({ from, to: await pageNow(page) });
  }
  return spans;
}

/**
 * The death path from the card: presses `press` until the next run plays, then, once the watch has stamped that play on
 * the following frame, returns the page time from the card's opening to it. It must be under DEATH_TO_PLAY_BUDGET_MS,
 * and not under the guard, with a press inside the guard that changed nothing: a play sooner would mean the guard did
 * not hold. The time includes the test driver's own input latency, which the page cannot separate out.
 */
async function dieThenPress(page: Page, press: Press): Promise<number> {
  const spans = await pressUntilPlays(page, press);
  await page.waitForFunction(() => typeof window.__caDeathWatch?.playAt === 'number');
  const { cardAt, playAt } = await page.evaluate(() => window.__caDeathWatch ?? { cardAt: null, playAt: null });
  if (cardAt === null || playAt === null) throw new Error('The death watch saw no card or no play');
  const ms = playAt - cardAt;
  const insideGuard = spans.filter(({ from, to }) => from >= cardAt && to <= cardAt + GAME_OVER_GUARD_MS);
  expect(insideGuard.length, 'a press went in while the guard held').toBeGreaterThan(0);
  expect(ms, 'the guard holds: that press changed nothing').toBeGreaterThanOrEqual(GAME_OVER_GUARD_MS - GUARD_SLACK_MS);
  expect(ms, 'death to play').toBeLessThan(DEATH_TO_PLAY_BUDGET_MS);
  return ms;
}

const pressKey =
  (page: Page, key: string): Press =>
  async () => {
    await page.keyboard.press(key);
    return true;
  };

/**
 * A tap at the middle of the end card's Continue, through the touch screen: unlike a locator's tap, it waits for no
 * animation to settle, so it can land as the card pops in. Before the card there is nothing to tap.
 */
const tapContinue =
  (page: Page): Press =>
  async () => {
    const box = await page.getByTestId('rank-continue').boundingBox();
    if (box === null) return false;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  };

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

test.describe('death to playing again', () => {
  test('R plays the Free galaxy again within the death budget, once the guard lapses @desktop', async ({ page }, testInfo) => {
    await startFreeRunNearGameOver(page);
    const ms = await dieThenPress(page, pressKey(page, 'KeyR'));
    testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
    expect(await gameState(page)).toMatchObject({ galaxy: GAME_OVER_GALAXY, lives: 3, rankRun: null });
  });

  test('Enter plays the Free galaxy again within the death budget @desktop', async ({ page }, testInfo) => {
    await startFreeRunNearGameOver(page);
    const ms = await dieThenPress(page, pressKey(page, 'Enter'));
    testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
  });

  test('Enter continues a Rank run within the death budget, once the guard lapses @desktop', async ({ page }, testInfo) => {
    await startOneLifeRun(page);
    await watchDeath(page);
    const ms = await dieThenPress(page, pressKey(page, 'Enter'));
    testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
    expect(await gameState(page)).toMatchObject({ lives: RANK_START_LIVES, rankRun: { continued: true } });
  });

  test('a tap on Continue continues a Rank run within the death budget, once the guard lapses @phone', async ({ page }, testInfo) => {
    await startOneLifeRun(page, true);
    await watchDeath(page);
    const ms = await dieThenPress(page, tapContinue(page));
    testInfo.annotations.push({ type: 'death to play', description: `${ms.toFixed(0)} ms` });
    await expectContinued(page);
  });
});

const newBest = (page: Page) => page.locator('.new-best');

/** Sim seconds that outlast the 'one-life-death' idle ship's one life. */
const ONE_LIFE_SECONDS = 60;

/** A save that has cleared `id` with a best of `bestScore`, which any real clear beats. */
const withGalaxyBest = (id: string, bestScore: number): SaveData => ({ ...defaultSave(), galaxies: { [id]: { bestScore, stars: 1 } } });

test.describe('"New best!"', () => {
  test('a Free play clear that beats the galaxy\'s best says so, with no number, since the card shows that score @desktop', async ({ page }) => {
    await seedSave(page, withGalaxyBest('1-1', 1));
    await pinClockSeed(page, seedFor('clears-1-1'));
    await openFreshGame(page);
    await playFreeGalaxy(page, '1-1');
    await fastForward(page, CLEAR_1_1_SECONDS);
    await expectMode(page, 'results');
    await expect(newBest(page)).toHaveText('New best!');
    expect((await storedSave(page)).galaxies?.['1-1']?.bestScore).toBe((await gameState(page)).score);
  });

  test('a Rank game over whose run tops the board says so, naming the run total beside the galaxy score @desktop', async ({ page }) => {
    const board = [{ score: 1000, reached: 'D1 · G1', date: '2026-10-01', continued: false }];
    await pinClockSeed(page, seedFor('one-life-death'));
    await seedSave(page, { ...defaultSave(), frontier: '1-3', rankRun: { ...startRank('2026-10-26'), next: GAME_OVER_GALAXY, score: 1500, lives: 1 }, rankSeq: 1, rankBoard: board }, { once: true });
    await openFreshGame(page);
    await page.getByTestId('resume-rank').click();
    await expectMode(page, 'playing');
    // The 'one-life-death' idle ship loses its one life a few seconds in, where the fast-forward stops.
    await fastForward(page, ONE_LIFE_SECONDS);
    await expectMode(page, 'gameOver');

    const total = Math.max(...((await storedSave(page)).rankBoard ?? []).map(({ score }) => score));
    const { score } = await gameState(page);
    expect(total).toBeGreaterThan(score);
    await expect(newBest(page)).toHaveText(`New best! ${String(total)}`);
  });

  test('a Daily clear that beats the date\'s earlier best says so @desktop', async ({ page }) => {
    const date = dateFor('daily-clears');
    await seedSave(page, { ...defaultSave(), daily: { lastCleared: date, streak: 1, bestStreak: 1, best: { date, score: 1 } } });
    await openDaily(page, date);
    await playDaily(page);
    await fastForward(page, DAILY_CLEAR_SECONDS);
    await expectMode(page, 'results');
    await expect(newBest(page)).toHaveText('New best!');
  });

  test('a first clear of a date shows no badge, as there was no best to beat @phone', async ({ page }) => {
    // The phone field the 'daily-clears' date is vouched for.
    await page.setViewportSize(PHONE_VIEWPORT);
    await openDaily(page, dateFor('daily-clears'));
    await playDaily(page, 'tap');
    await fastForward(page, DAILY_CLEAR_SECONDS);
    await expectMode(page, 'results');
    await expect(newBest(page)).toBeHidden();
  });
});
