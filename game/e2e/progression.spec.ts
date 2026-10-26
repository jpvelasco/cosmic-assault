import { SAVE_KEY } from '../src/meta/save';
import { expect, expectMode, fastForward, gameState, openFreshGame, pinClockSeed, test, waitForBridge } from './fixtures';

/** A run seed whose idle ship survives 1-1 to its warp on the desktop field (tests/unit/runController.test.ts plays it). */
const SURVIVES_1_1 = 2;

test('a clear is saved as the warp starts, so a reload during the warp keeps it', async ({ page }) => {
  // No debug switch, so the run writes the real save; the pinned clock gives it a known seed.
  await pinClockSeed(page, SURVIVES_1_1);
  await openFreshGame(page);
  await page.getByTestId('play').click();
  await page.getByTestId('mode-free').click();
  await page.getByTestId('dimension-1').click();
  await page.getByTestId('galaxy-1-1').click();
  await expectMode(page, 'playing');

  await fastForward(page, 95);
  expect((await gameState(page)).screen).toBe('results');
  const stored = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ frontier: '1-2' });
  // Straight away, while the warp still plays out under the card.
  await page.reload();
  await waitForBridge(page);

  const { save, screen } = await gameState(page);
  expect(screen).toBe('title');
  expect(save.frontier).toBe('1-2');
  expect(save.galaxies['1-1']?.stars).toBeGreaterThan(0);
  await page.getByTestId('play').click();
  await page.getByTestId('mode-free').click();
  await page.getByTestId('dimension-1').click();
  await expect(page.getByTestId('galaxy-1-2')).toBeEnabled();
});
