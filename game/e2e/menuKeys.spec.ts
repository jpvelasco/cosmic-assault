import type { Page } from '@playwright/test';
import { expect, expectMode, gameState, nextFrames, openGame, openGameOverRun, test, waitForGameOver, waitOutGameOverGuard } from './fixtures';

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

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Title' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expectModeHolds(page, 'title');
});
