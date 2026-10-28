import type { Page } from '@playwright/test';
import { defaultSave, type SaveData } from '../src/meta/save';
import { expect, expectMode, gameState, openFreshGame, seedLook, seedSave, test, waitForBridge } from './fixtures';

const openChip = (page: Page) => page.getByTestId('hangar-open');
const card = (page: Page) => page.getByTestId('hangar');
const back = (page: Page) => page.getByTestId('hangar-back');
const trim = (page: Page, id: string) => page.getByTestId(`hangar-skin-${id}`);
const engineTrail = (page: Page, id: string) => page.getByTestId(`hangar-trail-${id}`);
const settingsOf = async (page: Page) => (await gameState(page)).settings;

/** Three stars in each of eight galaxies: 24 stars, enough for Ember and Glacier, short of Aurora's 45. */
const TWENTY_FOUR: SaveData = {
  ...defaultSave(),
  galaxies: Object.fromEntries((['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '2-1', '2-2'] as const).map((id) => [id, { bestScore: 1000, stars: 3 }])),
};

test('the Hangar opens from the title, dims the looks the stars have not reached, and keys pick, save and close it @desktop', async ({ page }) => {
  await seedSave(page, TWENTY_FOUR);
  await openFreshGame(page);
  await expect(card(page)).toBeHidden();

  await openChip(page).click();
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('heading', { name: 'Hangar' })).toBeVisible();
  await expect(card(page).getByText('Stars won: 24 of 90')).toBeVisible();
  await expect(trim(page, 'ember')).toBeEnabled();
  await expect(trim(page, 'glacier')).toBeEnabled();
  // A look still locked is disabled, says so, and names its cost.
  await expect(trim(page, 'aurora')).toBeDisabled();
  await expect(card(page).getByRole('radio', { name: /Aurora.*Locked · ★ 45/ })).toBeDisabled();
  await expect(card(page).getByText('Locked · ★ 66')).toBeVisible();
  await expect(trim(page, 'classic')).toBeChecked();
  await expect(engineTrail(page, 'comet')).toBeEnabled();
  await expect(engineTrail(page, 'ion')).toBeDisabled();

  // The arrows move within a group and choose as they go; a game key does not start a run under the card.
  await expect(trim(page, 'classic')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(trim(page, 'ember')).toBeChecked();
  await expect.poll(async () => (await settingsOf(page)).skin).toBe('ember');
  await page.keyboard.press('ArrowRight');
  await expect(trim(page, 'glacier')).toBeFocused();
  await expect.poll(async () => (await gameState(page)).look.skin).toBe('glacier');
  await page.keyboard.press('Space');
  await expectMode(page, 'title');
  await expect(card(page)).toBeVisible();

  // Esc closes the card, back to its chip, and the choice holds across a reload.
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(openChip(page)).toBeFocused();
  await page.reload();
  await waitForBridge(page);
  await openChip(page).click();
  await expect(trim(page, 'glacier')).toBeChecked();
  expect(await settingsOf(page)).toMatchObject({ skin: 'glacier' });
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
});

test('the Hangar opens from mode select as well, and Esc returns focus to its chip there @desktop', async ({ page }) => {
  await seedSave(page, TWENTY_FOUR);
  await openFreshGame(page);
  await page.getByTestId('play').click();
  await expectMode(page, 'modeSelect');
  await openChip(page).click();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expectMode(page, 'modeSelect');
  await expect(openChip(page)).toBeFocused();
});

test('a trim the save no longer unlocks draws as the classic one, and the Hangar says so @desktop', async ({ page }) => {
  // The settings hold Nova, which needs 90 stars; this save has none, so the ship draws the default.
  await seedLook(page, { skin: 'nova', trail: 'prism' });
  await openFreshGame(page);
  expect(await settingsOf(page)).toMatchObject({ skin: 'nova', trail: 'prism' });
  expect((await gameState(page)).look).toEqual({ skin: 'classic', trail: 'standard' });

  await openChip(page).click();
  await expect(trim(page, 'classic')).toBeChecked();
  await expect(trim(page, 'nova')).toBeDisabled();
});

test('a phone taps the Hangar open, picks a trim, and taps Back @phone', async ({ page }) => {
  await seedSave(page, TWENTY_FOUR);
  await openFreshGame(page);
  await openChip(page).tap();
  await expect(card(page)).toBeVisible();
  await trim(page, 'ember').tap();
  await expect.poll(async () => (await settingsOf(page)).skin).toBe('ember');
  await back(page).tap();
  await expect(card(page)).toBeHidden();
  await expectMode(page, 'title');
  await expect(openChip(page)).toBeFocused();
});

test('the Hangar fits a phone at 844 by 390 without scrolling, with Back in reach @phone', async ({ page }) => {
  await seedSave(page, TWENTY_FOUR);
  await page.setViewportSize({ width: 844, height: 390 });
  await openFreshGame(page);
  await openChip(page).tap();
  await expect(card(page)).toBeVisible();
  const box = await back(page).boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(390);
  expect(await card(page).evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
});
