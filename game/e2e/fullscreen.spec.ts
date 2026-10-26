import type { Page } from '@playwright/test';
import { expect, expectMode, gameState, nextFrames, openGame, openGameOverRun, test, waitForGameOver } from './fixtures';

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

test('a refused request is logged, raises no console error and leaves the title as it was', async ({ page }) => {
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

test('the request is made inside the key and click handlers, not a later frame', async ({ page }) => {
  await page.addInitScript(() => {
    // `window.event` is the event being dispatched, and undefined once the handler has returned. Reflect.get
    // reads it without the typings' deprecation, which exists only to steer app code away from it.
    const calls: (string | null)[] = [];
    Object.assign(window, { __fullscreenCalls: calls });
    Element.prototype.requestFullscreen = function () {
      const current: unknown = Reflect.get(window, 'event');
      calls.push(current instanceof Event ? current.type : null);
      return Promise.resolve();
    };
  });
  await openGame(page);
  const calls = () => page.evaluate(() => (window as unknown as { __fullscreenCalls: (string | null)[] }).__fullscreenCalls);

  await page.keyboard.press('KeyF');
  await expect.poll(calls).toEqual(['keydown']);
  await chip(page).click();
  await expect.poll(calls).toEqual(['keydown', 'click']);
});

test('holding F toggles once, and Ctrl+F is left to the browser', async ({ page }) => {
  await openGame(page);
  await page.keyboard.down('KeyF');
  await page.keyboard.down('KeyF');
  await page.keyboard.down('KeyF');
  await page.keyboard.up('KeyF');
  await expectFullscreen(page, true);
  await nextFrames(page, 3);
  expect(await isFullscreen(page)).toBe(true);

  await page.keyboard.press('Control+KeyF');
  await nextFrames(page, 3);
  expect(await isFullscreen(page)).toBe(true);
});

test('the browser leaving full screen on its own updates the chip and bridge, and keeps the mode', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await chip(page).click();
  await expectFullscreen(page, true);
  await expect(chip(page)).toHaveText('Exit full screen');

  await page.evaluate(() => document.exitFullscreen());
  await expectFullscreen(page, false);
  await expect(chip(page)).toHaveText('Full screen');
  await nextFrames(page, 3);
  await expectMode(page, 'paused');
});

test('entering full screen re-lays out and redraws a paused frame', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await nextFrames(page, 3);
  const before = (await gameState(page)).drawCount;

  await page.keyboard.press('KeyF');
  await expectFullscreen(page, true);
  await expect.poll(async () => (await gameState(page)).drawCount).toBeGreaterThan(before);
});

test('F toggles full screen on the paused and game-over cards without changing the mode', async ({ page }) => {
  await openGameOverRun(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await page.keyboard.press('KeyF');
  await expectFullscreen(page, true);
  await expectMode(page, 'paused');
  await page.keyboard.press('KeyF');
  await expectFullscreen(page, false);

  await page.keyboard.press('Escape');
  await waitForGameOver(page);
  await page.keyboard.press('KeyF');
  await expectFullscreen(page, true);
  await expectMode(page, 'gameOver');
  await page.keyboard.press('KeyF');
  await expectFullscreen(page, false);
  await expectMode(page, 'gameOver');
});
