import { REBAKE_DELAY_MS } from '../src/render/layout';
import { expect, expectMode, gameState, nextFrames, openGame, openGameOverRun, test, waitForGameOver } from './fixtures';

test('a paused frame is redrawn once the deferred re-bake lands after a resize', async ({ page }) => {
  // A page clock makes the debounce deterministic: the re-bake fires only when the test advances time, so a
  // slow machine cannot let it land before the "stays still" check.
  await page.clock.install();
  await openGame(page);
  await page.keyboard.press('Enter');
  await page.clock.runFor(100);
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await page.clock.runFor(100);
  await expectMode(page, 'paused');
  await page.clock.pauseAt(Date.now() + 1000);

  const before = (await gameState(page)).drawCount;
  await page.setViewportSize({ width: 1000, height: 600 });
  // The resize event reaches the page on the browser's schedule, so step frames until the resize has redrawn
  // the paused screen; after that it stays still.
  await expect
    .poll(async () => {
      await page.clock.runFor(16);
      return (await gameState(page)).drawCount;
    })
    .toBeGreaterThan(before);
  const afterResize = (await gameState(page)).drawCount;
  await page.clock.runFor(REBAKE_DELAY_MS / 2);
  expect((await gameState(page)).drawCount).toBe(afterResize);

  await page.clock.runFor(REBAKE_DELAY_MS);
  expect((await gameState(page)).drawCount).toBe(afterResize + 1);
});

test('the death burst plays out under the game-over card, then the screen goes still', async ({ page }) => {
  await openGameOverRun(page);
  await page.keyboard.press('Enter');
  await waitForGameOver(page);
  const atGameOver = (await gameState(page)).drawCount;
  await nextFrames(page, 10);
  expect((await gameState(page)).drawCount).toBeGreaterThan(atGameOver);

  // Bursts live under 1.5 s; once the last particle is gone, nothing redraws.
  await expect
    .poll(async () => {
      const before = (await gameState(page)).drawCount;
      await nextFrames(page, 10);
      return (await gameState(page)).drawCount - before;
    })
    .toBe(0);
});
