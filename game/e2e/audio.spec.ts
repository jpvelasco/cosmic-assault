import type { Page } from '@playwright/test';
import { TOAST_MS } from '../src/ui/toast';
import { SETTINGS_KEY } from '../src/app/settings';
import { expect, expectMode, gameState, nextFrames, openGame, test, toastOf } from './fixtures';

const soundChip = (page: Page) => page.getByTestId('sound-toggle');

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
  await expect(toastOf(page)).toHaveText('Muted');
  // The live region stays in the page; it is emptied (and invisible) when the toast ends.
  await expect(toastOf(page)).toHaveText('', { timeout: TOAST_MS + 1500 });

  await page.keyboard.press('KeyM');
  await expectMuted(page, false);
  await expect(toastOf(page)).toHaveText('Sound on');

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

test('the sound chip mutes on the title and pause cards without starting or resuming', async ({ page }) => {
  await openGame(page);
  const chip = soundChip(page);
  await expect(chip).toHaveText('Sound: on');
  // The label carries the state, so the chip is a plain button rather than a pressed toggle.
  await expect(chip).not.toHaveAttribute('aria-pressed');

  await chip.click();
  await expectMuted(page, true);
  await expect(chip).toHaveText('Sound: off');
  await expect(chip).not.toHaveAttribute('aria-pressed');
  await expect(toastOf(page)).toHaveText('Muted');
  await nextFrames(page, 3);
  await expectMode(page, 'title');

  // M and the chip share one toggle, so the chip follows the key.
  await page.keyboard.press('KeyM');
  await expectMuted(page, false);
  await expect(chip).toHaveText('Sound: on');

  // A click does not focus the chip, so Space still starts the game.
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await expect(chip).toBeHidden();
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');
  await chip.click();
  await expectMuted(page, true);
  await expect(chip).toHaveText('Sound: off');
  await nextFrames(page, 3);
  await expectMode(page, 'paused');
});

test('Enter and Space on the focused sound chip toggle sound without starting the game', async ({ page }) => {
  await openGame(page);
  const chip = soundChip(page);
  await chip.focus();

  await page.keyboard.press('Enter');
  await expectMuted(page, true);
  await expect(chip).toHaveText('Sound: off');
  await page.keyboard.press('Space');
  await expectMuted(page, false);
  await expect(chip).toHaveText('Sound: on');
  await nextFrames(page, 3);
  await expectMode(page, 'title');
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
