import { REBAKE_DELAY_MS } from '../src/render/layout';
import { expect, expectMode, gameState, nextFrames, openGame, openGameOverRun, test, waitForGameOver } from './fixtures';

test('a paused frame is redrawn once the deferred re-bake lands after a resize', async ({ page }) => {
  await openGame(page);
  await page.keyboard.press('Enter');
  await expectMode(page, 'playing');
  await page.keyboard.press('Escape');
  await expectMode(page, 'paused');

  await page.setViewportSize({ width: 1000, height: 600 });
  // The resize itself redraws at once; after that the paused screen stays still.
  await nextFrames(page, 3);
  const afterResize = (await gameState(page)).drawCount;
  await nextFrames(page, 3);
  expect((await gameState(page)).drawCount).toBe(afterResize);

  // Deliberate wait: the re-bake fires REBAKE_DELAY_MS after the last resize.
  await page.waitForTimeout(REBAKE_DELAY_MS + 150);
  await nextFrames(page, 2);
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
