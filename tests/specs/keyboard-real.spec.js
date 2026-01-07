// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, startGame, getPlayer } = require('../helpers/game-helper');

/**
 * Test with REAL keyboard events (not simulateKeyDown)
 * This tests the actual browser keyboard event handling
 */
test.describe('Real Keyboard Events', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(200);
  });

  test('should turn left with real keyboard (ArrowLeft only)', async ({ page }) => {
    const initial = await getPlayer(page);

    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');

    const after = await getPlayer(page);
    console.log('Left only - Initial:', initial.angle, 'After:', after.angle);
    expect(after.angle).toBeLessThan(initial.angle);
  });

  test('should turn left while firing with real keyboard (Space + ArrowLeft)', async ({ page }) => {
    const initial = await getPlayer(page);

    // Hold space first
    await page.keyboard.down('Space');
    await page.waitForTimeout(100);

    // Then press left
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);

    const after = await getPlayer(page);

    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Space');

    console.log('Space+Left - Initial:', initial.angle, 'After:', after.angle, 'Diff:', after.angle - initial.angle);
    expect(after.angle).toBeLessThan(initial.angle);
  });

  test('should turn right while firing with real keyboard (Space + ArrowRight)', async ({ page }) => {
    const initial = await getPlayer(page);

    await page.keyboard.down('Space');
    await page.waitForTimeout(100);

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);

    const after = await getPlayer(page);

    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Space');

    console.log('Space+Right - Initial:', initial.angle, 'After:', after.angle, 'Diff:', after.angle - initial.angle);
    expect(after.angle).toBeGreaterThan(initial.angle);
  });

  test('should check key states during combo', async ({ page }) => {
    // Start holding space
    await page.keyboard.down('Space');
    await page.waitForTimeout(100);

    // Check space is registered
    const keysAfterSpace = await page.evaluate(() => {
      const input = window.__COSMIC_ASSAULT_TEST_API__;
      // Access the internal input system
      return { ...input.getState() };
    });
    console.log('After Space down - keys contain space?');

    // Now press ArrowLeft
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100);

    // Check both keys are registered
    const keysAfterBoth = await page.evaluate(() => {
      // Try to access internal key state
      const state = window.__COSMIC_ASSAULT_TEST_API__.getState();
      return state;
    });
    console.log('After both keys - game state:', keysAfterBoth.gameState);

    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Space');
  });

});
