// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, startGame, getPlayer, pressKey, releaseKey } = require('../helpers/game-helper');

/**
 * Test keyboard combinations - specifically the space + arrow keys bug
 */
test.describe('Keyboard Combinations', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);
  });

  test('should turn left while firing (space + ArrowLeft)', async ({ page }) => {
    const initialPlayer = await getPlayer(page);
    const initialAngle = initialPlayer.angle;

    // Hold space (firing) and try to turn left
    await pressKey(page, ' ');
    await page.waitForTimeout(100);

    await pressKey(page, 'ArrowLeft');
    await page.waitForTimeout(500);

    const playerAfter = await getPlayer(page);

    await releaseKey(page, 'ArrowLeft');
    await releaseKey(page, ' ');

    // Should have rotated left (angle decreased)
    console.log('Initial angle:', initialAngle);
    console.log('Final angle:', playerAfter.angle);
    console.log('Difference:', playerAfter.angle - initialAngle);

    expect(playerAfter.angle).toBeLessThan(initialAngle);
  });

  test('should turn right while firing (space + ArrowRight)', async ({ page }) => {
    const initialPlayer = await getPlayer(page);
    const initialAngle = initialPlayer.angle;

    // Hold space (firing) and try to turn right
    await pressKey(page, ' ');
    await page.waitForTimeout(100);

    await pressKey(page, 'ArrowRight');
    await page.waitForTimeout(500);

    const playerAfter = await getPlayer(page);

    await releaseKey(page, 'ArrowRight');
    await releaseKey(page, ' ');

    // Should have rotated right (angle increased)
    console.log('Initial angle:', initialAngle);
    console.log('Final angle:', playerAfter.angle);
    console.log('Difference:', playerAfter.angle - initialAngle);

    expect(playerAfter.angle).toBeGreaterThan(initialAngle);
  });

  test('should thrust while firing (space + ArrowUp)', async ({ page }) => {
    const initialPlayer = await getPlayer(page);

    // Hold space (firing) and thrust
    await pressKey(page, ' ');
    await page.waitForTimeout(100);

    await pressKey(page, 'ArrowUp');
    await page.waitForTimeout(500);

    const playerAfter = await getPlayer(page);

    await releaseKey(page, 'ArrowUp');
    await releaseKey(page, ' ');

    // Should have moved (velocity changed)
    const hasMoved = playerAfter.vx !== 0 || playerAfter.vy !== 0;
    expect(hasMoved).toBe(true);
  });

  test('should handle all keys simultaneously (space + ArrowUp + ArrowLeft)', async ({ page }) => {
    const initialPlayer = await getPlayer(page);
    const initialAngle = initialPlayer.angle;

    // Hold all keys
    await pressKey(page, ' ');
    await pressKey(page, 'ArrowUp');
    await pressKey(page, 'ArrowLeft');
    await page.waitForTimeout(500);

    const playerAfter = await getPlayer(page);

    await releaseKey(page, 'ArrowLeft');
    await releaseKey(page, 'ArrowUp');
    await releaseKey(page, ' ');

    // Should have rotated left AND moved
    expect(playerAfter.angle).toBeLessThan(initialAngle);
    const hasMoved = playerAfter.vx !== 0 || playerAfter.vy !== 0;
    expect(hasMoved).toBe(true);
  });

});
