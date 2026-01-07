// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForGameReady,
  getGameState,
  getPlayer,
  startGame,
  playForDuration
} = require('../helpers/game-helper');

/**
 * Stability tests - These tests verify the game doesn't crash under various conditions.
 * They're the "golden master" tests that ensure refactoring doesn't break the game.
 */
test.describe('Game Stability', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
  });

  test('should survive 30 seconds of continuous gameplay', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    // Play aggressively for 30 seconds
    await playForDuration(page, 30000, { shoot: true, move: true, pattern: 'circle' });

    const state = await getGameState(page);
    // Game should be in a valid state
    expect(['playing', 'gameOver']).toContain(state.gameState);
    expect(state.score).toBeGreaterThanOrEqual(0);
    expect(state.lives).toBeGreaterThanOrEqual(0);
  });

  test('should survive 60 seconds of gameplay without crashing', async ({ page }) => {
    test.slow(); // Mark as slow test

    await startGame(page);
    await page.waitForTimeout(100);

    // Play for 60 seconds
    await playForDuration(page, 60000, { shoot: true, move: true, pattern: 'random' });

    const state = await getGameState(page);
    expect(['playing', 'gameOver']).toContain(state.gameState);

    // Verify we can still read game state (not crashed)
    expect(state).toHaveProperty('score');
    expect(state).toHaveProperty('lives');
    expect(state).toHaveProperty('gameLevel');
  });

  test('should handle rapid game restarts', async ({ page }) => {
    // Start and restart game multiple times
    for (let i = 0; i < 5; i++) {
      await startGame(page);
      await page.waitForTimeout(500);

      let state = await getGameState(page);
      expect(state.gameState).toBe('playing');

      // Play briefly
      await playForDuration(page, 2000, { shoot: true, move: true });

      // Force game over by going to title (R key during game over)
      // Actually, we need to wait for game over or trigger it
      // For now, just verify game is still stable
      state = await getGameState(page);
      expect(['playing', 'gameOver']).toContain(state.gameState);
    }
  });

  test('should handle window resize during gameplay', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    // Play while resizing
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);

    let state = await getGameState(page);
    expect(state.gameState).toBe('playing');

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);

    state = await getGameState(page);
    expect(state.gameState).toBe('playing');

    // Verify player is still valid
    const player = await getPlayer(page);
    expect(player).not.toBeNull();
    expect(player.alive).toBe(true);
  });

  test('should recover from pause/resume (tab switch simulation)', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    // Play briefly
    await playForDuration(page, 2000, { shoot: true, move: true });

    // Simulate tab being backgrounded (blur event)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await page.waitForTimeout(500);

    // Simulate tab being focused again
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(500);

    // Game should still be running
    const state = await getGameState(page);
    expect(['playing', 'gameOver', 'paused']).toContain(state.gameState);
  });

});

test.describe('Memory & Performance Stability', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
  });

  test('should not accumulate excessive particles', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    // Shoot a lot to generate particles
    await playForDuration(page, 10000, { shoot: true, move: true });

    const { particles } = await page.evaluate(() =>
      window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts()
    );

    // Particle limit is 150 according to MAX_PARTICLES constant
    expect(particles).toBeLessThanOrEqual(150);
  });

  test('should properly clean up dead entities', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    // Play and generate lots of entities
    await playForDuration(page, 15000, { shoot: true, move: true });

    const counts = await page.evaluate(() =>
      window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts()
    );

    // Entity counts should be reasonable (not exploding)
    expect(counts.projectiles).toBeLessThan(100);
    expect(counts.asteroids).toBeLessThan(50);
    expect(counts.particles).toBeLessThanOrEqual(150);
  });

});
