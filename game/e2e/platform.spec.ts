import type { Page } from '@playwright/test';
import { expect, expectMode, gameState, nextFrames, openGame, openGameOverRun, test, waitForGameOver } from './fixtures';

const rotatePrompt = (page: Page) => page.getByTestId('rotate-prompt');
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const IDLE_CURSOR_WAIT_MS = 2300;

const cursorIdle = (page: Page) => page.evaluate(() => document.body.classList.contains('cursor-idle'));

async function startRun(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) await page.getByRole('heading', { name: 'Cosmic Assault' }).tap();
  else await page.keyboard.press('Space');
  await expectMode(page, 'playing');
}

test('the title and game-over hints name taps on a phone and keys on a desktop', async ({ page, isMobile }) => {
  await openGameOverRun(page);
  await expect(page.getByText(isMobile ? 'Tap to start' : 'Press Space to start')).toBeVisible();
  await startRun(page, isMobile);
  await waitForGameOver(page);

  await expect(page.getByText(isMobile ? 'Tap Restart to play again' : 'Press R to restart')).toBeVisible();
  // A touch player is never told about a key, anywhere in the page.
  if (isMobile) await expect(page.locator('body')).not.toContainText(/space|press /i);
});

test('the compact layout keeps the title card inside a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await openGame(page);

  const card = page.locator('.overlay--title .card');
  expect(await card.evaluate((el) => getComputedStyle(el).paddingTop), 'the compact padding applies').toBe('10px');
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(360);
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'The rotate prompt is for touch screens');

  test('held upright it asks for a turn and pauses a run, which stays paused when turned back', async ({ page }) => {
    await openGame(page);
    await expect(rotatePrompt(page)).toBeHidden();
    await startRun(page, true);

    await page.setViewportSize(PORTRAIT);
    await expect(rotatePrompt(page)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Rotate your phone to play' })).toBeVisible();
    await expectMode(page, 'paused');

    await page.setViewportSize(LANDSCAPE);
    await expect(rotatePrompt(page)).toBeHidden();
    await nextFrames(page, 3);
    await expectMode(page, 'paused');
    await page.getByRole('button', { name: 'Resume' }).tap();
    await expectMode(page, 'playing');
  });

  test('held upright on the title, it covers the card until the phone is turned', async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    await openGame(page);
    await expect(rotatePrompt(page)).toBeVisible();

    await page.setViewportSize(LANDSCAPE);
    await expect(rotatePrompt(page)).toBeHidden();
    await expectMode(page, 'title');
  });
});

test.describe('on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'These need a mouse');

  test('a tall window never asks for a turn', async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    await openGame(page);
    await startRun(page, false);

    await nextFrames(page, 3);
    await expect(rotatePrompt(page)).toBeHidden();
    await expectMode(page, 'playing');
  });

  test('the cursor hides after 2 s of rest in play, and a move, a pause or a quit brings it back', async ({ page }) => {
    await openGame(page);
    await page.mouse.move(100, 100);
    await page.waitForTimeout(IDLE_CURSOR_WAIT_MS);
    expect(await cursorIdle(page), 'the cursor stays on the title screen').toBe(false);

    await startRun(page, false);
    await expect.poll(() => cursorIdle(page), { timeout: IDLE_CURSOR_WAIT_MS * 2 }).toBe(true);
    await page.mouse.move(120, 130);
    expect(await cursorIdle(page)).toBe(false);

    await expect.poll(() => cursorIdle(page), { timeout: IDLE_CURSOR_WAIT_MS * 2 }).toBe(true);
    await page.keyboard.press('KeyP');
    await expectMode(page, 'paused');
    expect(await cursorIdle(page)).toBe(false);
  });

  test('reduced motion, switched mid-run, turns shake off unless the shake setting says on', async ({ page }) => {
    const motion = async () => (await gameState(page)).motion;
    await openGame(page);
    await startRun(page, false);
    await expect.poll(motion).toEqual({ reducedMotion: false, shake: true });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(motion).toEqual({ reducedMotion: true, shake: false });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(motion).toEqual({ reducedMotion: false, shake: true });

    await page.keyboard.press('KeyP');
    await page.getByTestId('settings-open').click();
    const card = page.getByRole('dialog', { name: 'Settings' });
    await card.getByRole('radio', { name: 'On' }).check();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(motion).toEqual({ reducedMotion: true, shake: true });

    await card.getByRole('radio', { name: 'Off' }).check();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(motion).toEqual({ reducedMotion: false, shake: false });
  });
});
