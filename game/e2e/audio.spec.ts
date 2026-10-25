import type { Page } from '@playwright/test';
import { TOAST_MS } from '../src/ui/toast';
import { SETTINGS_KEY } from '../src/app/settings';
import { expect, expectMode, gameState, nextFrames, openGame, test } from './fixtures';

const toast = (page: Page) => page.getByRole('status');

/** Keys are applied on the next animation frame, so state follows a press a frame later. */
const expectMuted = (page: Page, muted: boolean): Promise<void> =>
  expect.poll(async () => (await gameState(page)).muted).toBe(muted);

test('creates no audio context until the first key press, then runs', async ({ page }) => {
  await openGame(page);
  await nextFrames(page, 5);
  expect((await gameState(page)).audioState).toBe('none');

  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await expect.poll(async () => (await gameState(page)).audioState).toBe('running');
  // Fixture teardown fails the test on any console or page error.
});

test('a pointer press also unlocks audio', async ({ page }) => {
  await openGame(page);
  await page.mouse.click(300, 300);
  await expect.poll(async () => (await gameState(page)).audioState).toBe('running');
});

test('M toggles mute in every mode, shows a toast, and never starts the game', async ({ page }) => {
  await openGame(page);
  await expectMuted(page, false);

  await page.keyboard.press('KeyM');
  await expectMuted(page, true);
  await expectMode(page, 'title');
  await expect(toast(page)).toHaveText('Muted');
  // The live region stays in the page; it is emptied (and invisible) when the toast ends.
  await expect(toast(page)).toHaveText('', { timeout: TOAST_MS + 1500 });

  await page.keyboard.press('KeyM');
  await expectMuted(page, false);
  await expect(toast(page)).toHaveText('Sound on');

  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await page.keyboard.press('KeyM');
  await expectMuted(page, true);
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await page.keyboard.press('KeyM');
  await expectMuted(page, false);
});

test('mute survives a reload, and storage holds only the settings key', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('KeyM');
  await expectMuted(page, true);

  await openGame(page);
  await expectMuted(page, true);
  expect((await gameState(page)).audioState).toBe('none');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([SETTINGS_KEY]);
  expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)).toContain('"muted":true');
});

test('a corrupt saved setting falls back to sound on without errors', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, '{not json');
  }, SETTINGS_KEY);
  await openGame(page);
  await expectMuted(page, false);
});
