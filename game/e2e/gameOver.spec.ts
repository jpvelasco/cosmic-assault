import type { Page } from '@playwright/test';
import { expect, expectContinued, expectMode, fastForward, gameState, nextFrames, openGame, startOneLifeRun, test, waitForGameOver, waitOutGameOverGuard } from './fixtures';
import { FREE_GAME_OVER_SECONDS, GAME_OVER_GALAXY, seedFor } from './seeds';

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

test('R is ignored while the card opens and continues the run once the guard lapses', async ({ page }) => {
  await startOneLifeRun(page);

  await pressRAsTheCardOpens(page);
  await nextFrames(page, 3);
  expect((await gameState(page)).mode).toBe('gameOver');

  await waitOutGameOverGuard(page);
  await page.keyboard.press('KeyR');
  await expectContinued(page);
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

test('Continue on the card continues the run', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);

  await page.getByTestId('rank-continue').click();
  await expectContinued(page);
});

test('Title ends the run and returns to the title, where Play starts a fresh one', async ({ page }) => {
  await startOneLifeRun(page);
  await waitForGameOver(page);
  await waitOutGameOverGuard(page);
  await expect(page.getByTestId('rank-continue')).toBeVisible();

  await page.getByTestId('rank-title').click();
  await expectMode(page, 'title');
  expect((await gameState(page)).rankRun).toBeNull();
  await page.keyboard.press('Space');

  await expectMode(page, 'playing');
  const { lives, rankRun } = await gameState(page);
  expect(lives).toBe(1);
  expect(rankRun).toMatchObject({ score: 0, lives: 1, continued: false });
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

test('a Free play game over offers Retry, which plays the galaxy again at once, and Map', async ({ page }) => {
  // Three lives in 5-5: the 'free-game-over' seed's idle ship loses its last about 17 s in, so the test fast-forwards there.
  await openGame(page, { galaxy: GAME_OVER_GALAXY, seed: seedFor('free-game-over') });
  await page.keyboard.press('Space');
  await expectMode(page, 'playing');
  await fastForward(page, FREE_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await expect(page.getByTestId('rank-continue')).toBeHidden();
  await waitOutGameOverGuard(page);

  await page.getByTestId('results-retry').click();
  await expectMode(page, 'playing');
  expect(await gameState(page)).toMatchObject({ galaxy: '5-5', lives: 3, rankRun: null });

  await fastForward(page, FREE_GAME_OVER_SECONDS);
  await expectMode(page, 'gameOver');
  await waitOutGameOverGuard(page);
  await page.getByTestId('results-map').click();
  await expectMode(page, 'map');
});
