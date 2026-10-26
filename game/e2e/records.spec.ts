import type { Page } from '@playwright/test';
import type { RankEntry } from '../src/meta/rankBoard';
import { defaultSave, SAVE_KEY, type SaveData } from '../src/meta/save';
import { expect, expectMode, openFreshGame, seedSave, test } from './fixtures';

const openChip = (page: Page) => page.getByTestId('records-open');
const card = (page: Page) => page.getByTestId('records');
const rows = (page: Page) => card(page).getByRole('listitem');
const back = (page: Page) => page.getByTestId('records-back');

const BOARD: readonly RankEntry[] = [
  { score: 48200, reached: 'D3 · G4', date: '2026-10-20', continued: false },
  { score: 31050, reached: 'D2 · ★', date: '2026-10-22', continued: true },
];
const SAVED: SaveData = { ...defaultSave(), rankBoard: BOARD, classicBest: 12345, classicImported: true };

test('Records on the title shows the Rank board and the Classic best, and Back returns with focus on the chip', async ({ page }) => {
  await seedSave(page, SAVED);
  await openFreshGame(page);
  await expect(card(page)).toBeHidden();

  await openChip(page).click();
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('heading', { name: 'Records' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  for (const text of ['1', '48200', 'D3 · G4', '2026-10-20']) await expect(rows(page).nth(0)).toContainText(text);
  await expect(rows(page).nth(0)).not.toContainText('continued');
  for (const text of ['2', '31050', 'D2 · ★', '2026-10-22', 'continued']) await expect(rows(page).nth(1)).toContainText(text);
  await expect(card(page).getByText('Classic best: 12345')).toBeVisible();
  // Space would start on the title; under the card it does nothing.
  await card(page).getByRole('heading').click();
  await page.keyboard.press('Space');
  await expectMode(page, 'title');
  await expect(card(page)).toBeVisible();

  await back(page).click();
  await expect(card(page)).toBeHidden();
  await expectMode(page, 'title');
  await expect(openChip(page)).toBeFocused();
});

test('on mode select it says when the board is empty, takes the arrows, and Esc closes only the card @desktop', async ({ page }) => {
  await openFreshGame(page);
  await page.getByTestId('play').click();
  await expectMode(page, 'modeSelect');
  await openChip(page).click();

  await expect(card(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(card(page).getByText('No Rank runs yet')).toBeVisible();
  await expect(card(page).getByText(/Classic best/)).toBeHidden();
  await card(page).getByRole('heading').click();
  await page.keyboard.press('ArrowDown');
  await expect(back(page)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expectMode(page, 'modeSelect');
  await expect(openChip(page)).toBeFocused();
});

test('an open card shows a run another tab posts, without a reload @desktop', async ({ page, context }) => {
  await openFreshGame(page);
  await openChip(page).click();
  await expect(rows(page)).toHaveCount(0);

  const other = await context.newPage();
  await openFreshGame(other);
  await other.evaluate(([key, text]) => {
    localStorage.setItem(key, text);
  }, [SAVE_KEY, JSON.stringify(SAVED)] as const);

  await expect(rows(page)).toHaveCount(2);
  await expect(card(page).getByText('Classic best: 12345')).toBeVisible();
});

test('a phone taps through every menu card and Records, and back to the title @phone', async ({ page }) => {
  await seedSave(page, SAVED);
  await openFreshGame(page);
  await openChip(page).tap();
  await expect(rows(page)).toHaveCount(2);
  await back(page).tap();
  await expect(card(page)).toBeHidden();

  await page.getByTestId('play').tap();
  await expectMode(page, 'modeSelect');
  await page.getByTestId('mode-free').tap();
  await expectMode(page, 'map');
  await page.getByTestId('dimension-1').tap();
  await expectMode(page, 'galaxySelect');
  for (const screen of ['map', 'modeSelect', 'title'] as const) {
    await page.getByTestId('back').tap();
    await expectMode(page, screen);
  }
});
