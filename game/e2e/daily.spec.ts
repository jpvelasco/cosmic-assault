import type { Page } from '@playwright/test';
import { TWISTS_BY_ID } from '../src/content/daily';
import { nextDate, previousDate } from '../src/meta/calendar';
import { dailyGalaxy } from '../src/meta/dailyGalaxy';
import { defaultSave, type SaveData } from '../src/meta/save';
import { DAILY_CLEARED, dailyTitle, targetLine, twistToast } from '../src/ui/dailyCopy';
import { PRESSURE } from '../tests/helpers/pressure';
import { DAILY_CLEAR_SECONDS, DAILY_GAME_OVER_SECONDS, dateFor, PHONE_PORTRAIT_VIEWPORT, PHONE_VIEWPORT } from './seeds';
import {
  clickPastGuard,
  collectPickup,
  dailyCardLineOf,
  expect,
  expectMode,
  fastForward,
  gameState,
  openDaily,
  openFreshGame,
  openModeSelect,
  playDaily,
  seedSave,
  setPageHidden,
  storedSave,
  test,
  toastOf,
  waitForBridge,
  waitOutGameOverGuard,
} from './fixtures';

const CLEAR_DATE = dateFor('daily-clears');
const GAME_OVER_DATE = dateFor('daily-game-over');

/** A returning player's save, with progress of every kind but the Daily's, already past the classic import. */
const PROGRESS: SaveData = {
  ...defaultSave(),
  frontier: '2-2',
  galaxies: { '1-1': { bestScore: 1800, stars: 3 }, '1-2': { bestScore: 900, stars: 1 } },
  rankBoard: [{ score: 9000, reached: 'D2 · G1', date: '2026-01-02', continued: false }],
  classicBest: 4321,
  classicImported: true,
};

/** Everything in a stored save but the Daily record. */
const outsideDaily = (save: Partial<SaveData>): Record<string, unknown> => Object.fromEntries(Object.entries(save).filter(([key]) => key !== 'daily'));

const dailyCard = (page: Page) => page.getByTestId('mode-daily');

/** What every mode card's box and text make of the viewport: a card outside it, or a card whose text spills out of it. */
function cardProblems(page: Page): Promise<string[]> {
  return page.locator('.mode-card').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const box = card.getBoundingClientRect();
      const name = card.querySelector('.mode-card__name')?.textContent ?? 'a card';
      const problems: string[] = [];
      if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) problems.push(`${name} lies outside the viewport`);
      if (card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1) problems.push(`${name}'s text spills out of the card`);
      return problems;
    }),
  );
}

test('the Daily card names the day\'s twist and target, and Enter on it plays that date with the twist announced @desktop', async ({ page }) => {
  const daily = dailyGalaxy(CLEAR_DATE);
  const twist = TWISTS_BY_ID[daily.twist];
  await page.setViewportSize({ width: 1366, height: 860 });
  await openDaily(page, CLEAR_DATE);
  await page.keyboard.press('Space');
  await expectMode(page, 'modeSelect');
  await expect(dailyCard(page)).toContainText(dailyCardLineOf(CLEAR_DATE));
  await expect(dailyCard(page)).toContainText(twist.blurb);
  await expect(page.getByTestId('daily-streak')).toBeHidden();
  expect(await cardProblems(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('daily-modes-1366x860.png') });

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(dailyCard(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expectMode(page, 'playing');
  const state = await gameState(page);
  expect(state.daily).toEqual({ date: CLEAR_DATE, twist: daily.twist, target: daily.target });
  expect(state.galaxy).toBe(daily.def.id);
  expect(state.palette).toBe(daily.def.palette);
  await expect(toastOf(page)).toHaveText(twistToast(twist.name));
});

/** Noon on `date` in the browser's time zone: half a day from either midnight. */
const noonOn = (date: string): Date => new Date(`${date}T12:00:00`);

test('a Daily card resting across midnight shows the new day once the page is back in view or focus, and a press on a stale card redraws it, keeping focus, before anything plays @desktop', async ({ page }) => {
  const first = CLEAR_DATE;
  const second = nextDate(first);
  const third = nextDate(second);
  const fourth = nextDate(third);
  // Each step can only tell that the card moved on if no two days show the same line.
  expect(new Set([first, second, third, fourth].map(dailyCardLineOf)).size).toBe(4);
  // No `?today=`: the game reads the device's clock, which only `Date` is faked for, so the game loop runs as normal.
  await page.clock.setFixedTime(noonOn(first));
  await openFreshGame(page);
  await openModeSelect(page);
  await expect(dailyCard(page)).toContainText(dailyCardLineOf(first));

  await page.clock.setFixedTime(noonOn(second));
  await setPageHidden(page, false);
  await expect(dailyCard(page)).toContainText(dailyCardLineOf(second));

  await page.clock.setFixedTime(noonOn(third));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dailyCard(page)).toContainText(dailyCardLineOf(third));

  await page.clock.setFixedTime(noonOn(fourth));
  await dailyCard(page).focus();
  await page.keyboard.press('Enter');
  await expect(dailyCard(page)).toContainText(dailyCardLineOf(fourth));
  await expect(dailyCard(page)).toBeFocused();
  await expectMode(page, 'modeSelect');
  await page.keyboard.press('Enter');
  await expectMode(page, 'playing');
  expect((await gameState(page)).daily?.date).toBe(fourth);
});

test('a Daily clear shows its target and no stars, writes no progress but the Daily record, and Retry plays the same date @desktop', async ({ page }) => {
  const daily = dailyGalaxy(CLEAR_DATE);
  await seedSave(page, PROGRESS);
  // Played on the project's own 1280×720 field, where the date's idle ship clears it.
  await openDaily(page, CLEAR_DATE);
  await playDaily(page);

  await fastForward(page, DAILY_CLEAR_SECONDS);
  await expectMode(page, 'results');
  const { score } = await gameState(page);
  await expect(page.getByRole('heading', { name: DAILY_CLEARED })).toBeVisible();
  await expect(page.getByText(dailyTitle(CLEAR_DATE))).toBeVisible();
  await expect(page.getByTestId('end-target')).toHaveText(targetLine(daily.target, score));
  await expect(page.locator('.overlay--game-over .stars')).toBeHidden();
  // The date's first clear has no earlier best to beat.
  await expect(page.locator('.new-best')).toBeHidden();
  for (const hidden of ['results-next', 'results-map', 'rank-continue']) await expect(page.getByTestId(hidden)).toBeHidden();
  await expect(page.getByTestId('results-retry')).toBeVisible();
  await expect(page.getByTestId('daily-title')).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.screenshot({ path: test.info().outputPath('daily-results-1366x860.png') });

  const stored = await storedSave(page);
  expect(stored.daily).toEqual({ lastCleared: CLEAR_DATE, streak: 1, bestStreak: 1, best: { date: CLEAR_DATE, score } });
  expect(outsideDaily(stored)).toEqual(outsideDaily(PROGRESS));

  await clickPastGuard(page, 'results-retry', 'playing');
  expect((await gameState(page)).daily?.date).toBe(CLEAR_DATE);
});

test('a Daily that collects a first pickup marks it seen, and writes nothing else outside the Daily record @desktop', async ({ page }) => {
  await seedSave(page, PROGRESS);
  await openDaily(page, CLEAR_DATE);
  await playDaily(page);
  await collectPickup(page, 'doubleShot');
  await expect.poll(async () => outsideDaily(await storedSave(page))).toEqual(outsideDaily({ ...PROGRESS, seenPickups: ['doubleShot'] }));
  expect((await storedSave(page)).daily).toEqual(PROGRESS.daily);
});

test('a Daily game over writes nothing; R plays the same date again and Escape goes to the title @desktop', async ({ page }) => {
  await seedSave(page, PROGRESS);
  await openDaily(page, GAME_OVER_DATE);
  await playDaily(page);
  await fastForward(page, DAILY_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await expect(page.getByText(dailyTitle(GAME_OVER_DATE))).toBeVisible();
  for (const hidden of ['results-next', 'results-map', 'rank-continue']) await expect(page.getByTestId(hidden)).toBeHidden();
  expect(await storedSave(page)).toEqual(PROGRESS);

  await waitOutGameOverGuard(page);
  await page.keyboard.press('KeyR');
  await expectMode(page, 'playing');
  expect((await gameState(page)).daily?.date).toBe(GAME_OVER_DATE);
  await fastForward(page, DAILY_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await waitOutGameOverGuard(page);
  await page.keyboard.press('Escape');
  await expectMode(page, 'title');
  expect((await gameState(page)).daily).toBeNull();
});

test('the mode select streak shows from 2, and the records card shows the Daily record @desktop', async ({ page }) => {
  const yesterday = previousDate(CLEAR_DATE);
  const save: SaveData = { ...PROGRESS, daily: { lastCleared: yesterday, streak: 4, bestStreak: 6, best: { date: yesterday, score: 12345 } } };
  await seedSave(page, save);
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page);
  await expect(page.getByTestId('daily-streak')).toHaveText('Streak 4');
  await page.getByTestId('records-open').click();
  await expect(page.getByTestId('records-daily')).toHaveText(new RegExp(`Streak 4\\s*Best streak 6\\s*Best on ${yesterday}: 12,345`));
});

test('a tap on the Daily card plays it, and the three cards fit a phone on its side @phone', async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page, 'tap');
  await expect(page.locator('.mode-card')).toHaveCount(3);
  expect(await cardProblems(page)).toEqual([]);
  const back = await page.getByTestId('back').boundingBox();
  expect((back?.y ?? Infinity) + (back?.height ?? 0)).toBeLessThanOrEqual(PHONE_VIEWPORT.height);
  await page.screenshot({ path: test.info().outputPath('daily-modes-844x390.png') });

  await dailyCard(page).tap();
  await expectMode(page, 'playing');
  expect((await gameState(page)).daily?.date).toBe(CLEAR_DATE);
});

test('held upright, a phone shows the rotate prompt over mode select @phone', async ({ page }) => {
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page, 'tap');
  await page.setViewportSize(PHONE_PORTRAIT_VIEWPORT);
  await expect(page.getByTestId('rotate-prompt')).toBeVisible();
});

test('the Daily results card fits a phone on its side @phone', async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await openDaily(page, CLEAR_DATE);
  await playDaily(page, 'tap');
  await fastForward(page, DAILY_CLEAR_SECONDS);
  await expectMode(page, 'results');
  await expect(page.getByRole('heading', { name: DAILY_CLEARED })).toBeVisible();
  const retry = await page.getByTestId('results-retry').boundingBox();
  expect((retry?.y ?? Infinity) + (retry?.height ?? 0)).toBeLessThanOrEqual(PHONE_VIEWPORT.height);
  await page.screenshot({ path: test.info().outputPath('daily-results-844x390.png') });
});

/** The Rank part of a save, which no Daily touches. */
const rankPart = (save: Partial<SaveData>) => ({ rankBoard: save.rankBoard, rankSeq: save.rankSeq, rankRun: save.rankRun });

/** Mode select → the Daily card → its clear, by fast-forward; the results card is up on return. */
async function clearDailyFromModeSelect(page: Page): Promise<void> {
  await playDaily(page);
  await fastForward(page, DAILY_CLEAR_SECONDS);
  await expectMode(page, 'results');
}

/** What the player can read on the page now, which must never press or speak of loss. */
async function expectNoPressure(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(PRESSURE);
}

test('a clear starts the streak, the next date\'s clear runs it to 2, and two dates later it is simply not shown, with nothing pressing @desktop', async ({ page }) => {
  const first = dateFor('daily-streak');
  const second = nextDate(first);
  const later = nextDate(nextDate(second));
  await seedSave(page, PROGRESS, { once: true });
  const rankBefore = rankPart(PROGRESS);

  await openDaily(page, first);
  await clearDailyFromModeSelect(page);
  await page.reload();
  await waitForBridge(page);
  await page.getByTestId('records-open').click();
  await expect(page.getByTestId('records-daily')).toContainText('Streak 1');
  await page.keyboard.press('Escape');
  expect(rankPart(await storedSave(page))).toEqual(rankBefore);

  await openDaily(page, second);
  await clearDailyFromModeSelect(page);
  expect((await storedSave(page)).daily).toMatchObject({ lastCleared: second, streak: 2, bestStreak: 2 });
  await clickPastGuard(page, 'daily-title', 'title');
  await openModeSelect(page);
  await expect(page.getByTestId('daily-streak')).toHaveText('Streak 2');
  expect(rankPart(await storedSave(page))).toEqual(rankBefore);

  await openDaily(page, later);
  await openModeSelect(page);
  await expect(page.getByTestId('daily-streak')).toBeHidden();
  await expectNoPressure(page);
  await page.getByTestId('records-open').click();
  await expect(page.getByTestId('records-daily')).toContainText('Best streak 2');
  expect(await page.locator('.records-daily__line').allTextContents()).not.toContainEqual(expect.stringMatching(/^Streak \d+$/));
  await expectNoPressure(page);
  expect(rankPart(await storedSave(page))).toEqual(rankBefore);
});
