import type { Page } from '@playwright/test';
import { practiceSettings } from '../src/sim/asteroid';
import {
  expect,
  expectMode,
  gameState,
  nextFrames,
  openGameOverRun,
  test,
  waitForGameOver,
  waitOutGameOverGuard,
} from './fixtures';

async function startOneLifeRun(page: Page): Promise<void> {
  await openGameOverRun(page);
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  expect((await gameState(page)).lives).toBe(1);
}

/**
 * Presses R (keydown and keyup) in the same frame the card opens, from inside the page, so the
 * press lands well within the guard however slowly the test process polls.
 */
function pressRAsTheCardOpens(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const watch = (): void => {
          if (window.__COSMIC_ASSAULT_TEST_API__?.getState().mode === 'gameOver') {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR' }));
            resolve();
          } else {
            requestAnimationFrame(watch);
          }
        };
        watch();
      }),
  );
}

test('R is ignored while the card opens and restarts once the guard lapses', async ({ page }) => {
  await startOneLifeRun(page);

  await pressRAsTheCardOpens(page);
  await nextFrames(page, 3);
  expect((await gameState(page)).mode).toBe('gameOver');

  await waitOutGameOverGuard(page);
  await page.keyboard.press('KeyR');
  await expectMode(page, 'playing');
  expect((await gameState(page)).lives).toBe(1);
});

test('a click on the card outside its buttons does not restart', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);

  await page.mouse.click(20, 20);
  await nextFrames(page, 3);

  expect((await gameState(page)).mode).toBe('gameOver');
  await expect(page.getByText(/^Score \d+$/)).toBeVisible();
});

test('Title returns to the title, where the chosen level starts the next run', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);

  await page.getByRole('button', { name: 'Title' }).click();
  await expectMode(page, 'title');
  await page.getByRole('button', { name: '4', exact: true }).click();
  await expect.poll(async () => (await gameState(page)).practiceLevel).toBe(4);
  await page.keyboard.press('Space');

  await expectMode(page, 'playing');
  expect((await gameState(page)).practiceLevel).toBe(4);
  // The run tops up one asteroid per step to level 4's minimum of 6 within a few steps; level 1
  // (minimum 3, one timed spawn per 3.5 s) cannot reach 6 inside this 2 s window.
  await expect
    .poll(async () => (await gameState(page)).asteroidCount, { timeout: 2000 })
    .toBeGreaterThanOrEqual(practiceSettings(4).minAsteroids);
});

test('a fire key held through the restart does not fire until pressed again', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);

  await page.keyboard.down('Space');
  await waitOutGameOverGuard(page);
  await page.keyboard.press('KeyR');
  await expectMode(page, 'playing');
  // Deliberate wait: the assertion is that the held key fires nothing during it.
  await page.waitForTimeout(500);
  expect((await gameState(page)).projectileCount).toBe(0);

  await page.keyboard.up('Space');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await gameState(page)).projectileCount).toBeGreaterThan(0);
  await page.keyboard.up('Space');
});
