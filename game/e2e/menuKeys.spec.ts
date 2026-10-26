import type { Page } from '@playwright/test';
import { defaultSave } from '../src/meta/save';
import { expect, expectMode, gameState, nextFrames, openGame, openGameOverRun, seedSave, test, waitForGameOver, waitOutGameOverGuard } from './fixtures';

// Enter and Space on a focused menu button do that button's action and nothing else, the same as a click.

/** Leaves a few frames for a key that leaked to the game's own key handling to take effect, then checks the mode held. */
async function expectModeHolds(page: Page, mode: CosmicAssaultTestState['mode']): Promise<void> {
  await expectMode(page, mode);
  await nextFrames(page, 3);
  expect((await gameState(page)).mode).toBe(mode);
}

test('Enter on the focused Quit lands on the title and does not start a run', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Quit' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expectModeHolds(page, 'title');
  expect((await gameState(page)).ship).toBeNull();
});

test('Space on the focused Play opens mode select without starting a run, and Escape comes back', async ({ page }) => {
  await openGame(page, { galaxy: null });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('play')).toBeFocused();

  await page.keyboard.press('Space');
  await expectModeHolds(page, 'modeSelect');
  expect((await gameState(page)).ship).toBeNull();

  // Arrows move focus on the next frame, so Enter waits until it has.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('mode-rank')).toBeFocused();
  await page.keyboard.press('Escape');
  await expectModeHolds(page, 'title');
});

test('a mouse press on a card button drops the focus the keys had reached, so Space still starts a run', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('play')).toBeFocused();

  await page.getByTestId('sound-toggle').click();
  await expect.poll(async () => (await gameState(page)).muted).toBe(true);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expectModeHolds(page, 'title');

  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
});

test('Enter on the focused game-over Title button lands on the title', async ({ page }) => {
  await openGameOverRun(page);
  await page.keyboard.press('Space');
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);

  // The first arrow focuses Continue; Title sits beside it in the card's button row.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Title' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expectModeHolds(page, 'title');
});

test('arrow keys walk the side-by-side mode cards and the row of Dimensions, skipping the locked ones', async ({ page }) => {
  await seedSave(page, { ...defaultSave(), frontier: '3-1' });
  await openGame(page, { galaxy: null });
  await page.keyboard.press('Space');
  await expectMode(page, 'modeSelect');
  // The first arrow lands on the first card; Rank and Free play sit side by side.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('mode-rank')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('mode-free')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('mode-rank')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  // Arrows move focus on the next frame, while Enter presses the focused button at once.
  await expect(page.getByTestId('mode-free')).toBeFocused();
  await page.keyboard.press('Enter');
  await expectMode(page, 'map');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('dimension-1')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('dimension-3')).toBeFocused();
  // D4 and D5 are locked, so the row ends here.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('dimension-3')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('back')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('dimension-3')).toBeFocused();
  await page.keyboard.press('Enter');
  await expectMode(page, 'galaxySelect');
});
