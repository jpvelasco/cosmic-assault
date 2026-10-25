import type { Page } from '@playwright/test';
import { expect, expectMode, gameState, nextFrames, openGame, test } from './fixtures';

const chip = (page: Page) => page.getByTestId('fullscreen-toggle');
const isFullscreen = (page: Page): Promise<boolean> => page.evaluate(() => document.fullscreenElement !== null);

/** Keys are applied on the next animation frame, and the browser reports full screen a little later still. */
const expectFullscreen = async (page: Page, on: boolean): Promise<void> => {
  await expect.poll(() => isFullscreen(page)).toBe(on);
  await expect.poll(async () => (await gameState(page)).fullscreen).toBe(on);
};

test('F enters and leaves full screen, and never starts the game', async ({ page }) => {
  await openGame(page);
  expect((await gameState(page)).fullscreen).toBe(false);

  await page.keyboard.press('KeyF');
  await expectFullscreen(page, true);
  await expect(chip(page)).toHaveText('Exit full screen');

  await page.keyboard.press('KeyF');
  await expectFullscreen(page, false);
  await expect(chip(page)).toHaveText('Full screen');
  await nextFrames(page, 3);
  await expectMode(page, 'title');
});

test('the full-screen chip toggles it on the title and pause cards without starting or resuming', async ({ page }) => {
  await openGame(page);
  await expect(chip(page)).toHaveText('Full screen');
  await expect(chip(page)).not.toHaveAttribute('aria-pressed');

  await chip(page).click();
  await expectFullscreen(page, true);
  await nextFrames(page, 3);
  await expectMode(page, 'title');
  await chip(page).click();
  await expectFullscreen(page, false);

  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await chip(page).click();
  await expectFullscreen(page, true);
  await nextFrames(page, 3);
  await expectMode(page, 'paused');
});

test('F works mid-run and the run keeps going', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');

  await page.keyboard.press('KeyF');
  await expectFullscreen(page, true);
  await nextFrames(page, 3);
  await expectMode(page, 'playing');
});

test('Enter and Space on the focused full-screen chip toggle it without starting the game', async ({ page }) => {
  await openGame(page);
  await chip(page).focus();

  await page.keyboard.press('Enter');
  await expectFullscreen(page, true);
  await page.keyboard.press('Space');
  await expectFullscreen(page, false);
  await nextFrames(page, 3);
  await expectMode(page, 'title');
});

test('the chip is hidden where full screen is unavailable, and F does nothing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { value: false, configurable: true });
  });
  await openGame(page);
  await expect(chip(page)).toBeHidden();
  const before = (await gameState(page)).logSize;

  await page.keyboard.press('KeyF');
  await nextFrames(page, 3);
  expect(await isFullscreen(page)).toBe(false);
  expect((await gameState(page)).logSize).toBe(before);
});

test('a refused request is logged without a console error and leaves the game running', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('denied'));
  });
  await openGame(page);
  const before = (await gameState(page)).logSize;

  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await gameState(page)).logSize).toBe(before + 1);
  expect((await gameState(page)).fullscreen).toBe(false);
  await expectMode(page, 'title');
});
