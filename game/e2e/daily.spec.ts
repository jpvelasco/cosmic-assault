import type { Page } from '@playwright/test';
import { TWISTS_BY_ID } from '../src/content/daily';
import { dailyGalaxy } from '../src/meta/dailyGalaxy';
import { defaultSave, type SaveData } from '../src/meta/save';
import { DAILY_CLEARED, dailyCardLine, dailyTitle, targetLine, twistToast } from '../src/ui/dailyCopy';
import { DAILY_CLEAR_SECONDS, DAILY_GAME_OVER_SECONDS, dateFor } from './seeds';
import {
  clickPastGuard,
  expect,
  expectMode,
  fastForward,
  gameState,
  openDaily,
  seedSave,
  storedSave,
  test,
  toastOf,
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

/** Title → mode select, by a click on Play. */
async function openModeSelect(page: Page, press: 'click' | 'tap' = 'click'): Promise<void> {
  await page.getByTestId('play')[press]();
  await expectMode(page, 'modeSelect');
}

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
  await expect(dailyCard(page)).toContainText(dailyCardLine(twist.name, daily.target));
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

test('a Daily clear shows its target and no stars, writes the Daily record alone, and Retry plays the same date @desktop', async ({ page }) => {
  const daily = dailyGalaxy(CLEAR_DATE);
  await seedSave(page, PROGRESS);
  // Played on the project's own 1280×720 field, where the date's idle ship clears it.
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page);
  await dailyCard(page).click();
  await expectMode(page, 'playing');

  await fastForward(page, DAILY_CLEAR_SECONDS);
  await expectMode(page, 'results');
  const { score } = await gameState(page);
  await expect(page.getByRole('heading', { name: DAILY_CLEARED })).toBeVisible();
  await expect(page.getByText(dailyTitle(CLEAR_DATE))).toBeVisible();
  await expect(page.getByTestId('end-target')).toHaveText(targetLine(daily.target, score));
  await expect(page.locator('.overlay--game-over .stars')).toBeHidden();
  for (const hidden of ['results-next', 'results-map', 'rank-continue']) await expect(page.getByTestId(hidden)).toBeHidden();
  await expect(page.getByTestId('results-retry')).toBeVisible();
  await expect(page.getByTestId('rank-title')).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.screenshot({ path: test.info().outputPath('daily-results-1366x860.png') });

  const stored = await storedSave(page);
  expect(stored.daily).toEqual({ lastCleared: CLEAR_DATE, streak: 1, bestStreak: 1, best: { date: CLEAR_DATE, score } });
  expect(outsideDaily(stored)).toEqual(outsideDaily(PROGRESS));

  await clickPastGuard(page, 'results-retry', 'playing');
  expect((await gameState(page)).daily?.date).toBe(CLEAR_DATE);
});

test('a Daily game over writes nothing; R plays the same date again and Escape goes to the title @desktop', async ({ page }) => {
  await seedSave(page, PROGRESS);
  await openDaily(page, GAME_OVER_DATE);
  await openModeSelect(page);
  await dailyCard(page).click();
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
  const save: SaveData = { ...PROGRESS, daily: { lastCleared: '2026-01-03', streak: 4, bestStreak: 6, best: { date: '2026-01-03', score: 12345 } } };
  await seedSave(page, save);
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page);
  await expect(page.getByTestId('daily-streak')).toHaveText('Streak 4');
  await page.getByTestId('records-open').click();
  await expect(page.getByTestId('records-daily')).toHaveText(/Streak 4\s*Best streak 6\s*Best on 2026-01-03: 12,345/);
});

test('a tap on the Daily card plays it, and the three cards fit a phone on its side @phone', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page, 'tap');
  await expect(page.locator('.mode-card')).toHaveCount(3);
  expect(await cardProblems(page)).toEqual([]);
  const back = await page.getByTestId('back').boundingBox();
  expect((back?.y ?? Infinity) + (back?.height ?? 0)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('daily-modes-844x390.png') });

  await dailyCard(page).tap();
  await expectMode(page, 'playing');
  expect((await gameState(page)).daily?.date).toBe(CLEAR_DATE);
});

test('held upright, a phone shows the rotate prompt over mode select @phone', async ({ page }) => {
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page, 'tap');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('rotate-prompt')).toBeVisible();
});

test('the Daily results card fits a phone on its side @phone', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openDaily(page, CLEAR_DATE);
  await openModeSelect(page, 'tap');
  await dailyCard(page).tap();
  await fastForward(page, DAILY_CLEAR_SECONDS);
  await expectMode(page, 'results');
  await expect(page.getByRole('heading', { name: DAILY_CLEARED })).toBeVisible();
  const retry = await page.getByTestId('results-retry').boundingBox();
  expect((retry?.y ?? Infinity) + (retry?.height ?? 0)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('daily-results-844x390.png') });
});
