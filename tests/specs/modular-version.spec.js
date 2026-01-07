// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForGameReady,
  getGameState,
  getPlayer,
  getEntityCounts,
  startGame,
  playForDuration
} = require('../helpers/game-helper');

/**
 * Tests for the modular version of the game
 * These tests run against index-modular.html to verify the refactored code works
 */
test.describe('Modular Version', () => {

  test.beforeEach(async ({ page }) => {
    // Use the modular version
    await page.goto('/index-modular.html');
    await waitForGameReady(page);
  });

  test('should load modular version successfully', async ({ page }) => {
    // Check for version indicator
    const versionIndicator = await page.locator('#version-indicator');
    await expect(versionIndicator).toContainText('MODULAR');

    // Verify test API is loaded with v2.0
    const version = await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.version);
    expect(version).toBe('2.0.0');
  });

  test('should display title screen', async ({ page }) => {
    const state = await getGameState(page);
    expect(state.gameState).toBe('title');
  });

  test('should start game and spawn player', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const state = await getGameState(page);
    expect(state.gameState).toBe('playing');

    const player = await getPlayer(page);
    expect(player).not.toBeNull();
    expect(player.alive).toBe(true);
  });

  test('should spawn initial asteroids', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const entities = await getEntityCounts(page);
    expect(entities.asteroids).toBeGreaterThanOrEqual(3);
  });

  test('should have working gameplay for 30 seconds', async ({ page }) => {
    test.slow(); // Mark as slow test

    await startGame(page);
    await page.waitForTimeout(100);

    // Play for 30 seconds
    await playForDuration(page, 30000, { shoot: true, move: true, pattern: 'circle' });

    const state = await getGameState(page);
    // Should be either playing or game over (not crashed)
    expect(['playing', 'gameOver']).toContain(state.gameState);
  });

  test('should match original version behavior - initial state', async ({ page, context }) => {
    // Get state from modular version
    const modularState = await getGameState(page);

    // Open original version in new page
    const originalPage = await context.newPage();
    await originalPage.goto('/');
    await waitForGameReady(originalPage);
    const originalState = await getGameState(originalPage);

    // Compare initial states
    expect(modularState.gameState).toBe(originalState.gameState);
    expect(modularState.score).toBe(originalState.score);
    expect(modularState.lives).toBe(originalState.lives);
    expect(modularState.gameLevel).toBe(originalState.gameLevel);

    await originalPage.close();
  });

  test('should have same configuration as original', async ({ page, context }) => {
    const modularConfig = await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getConfig());

    const originalPage = await context.newPage();
    await originalPage.goto('/');
    await waitForGameReady(originalPage);
    const originalConfig = await originalPage.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getConfig());

    // Compare configurations
    expect(modularConfig.SHIP_SIZE).toBe(originalConfig.SHIP_SIZE);
    expect(modularConfig.POWERUP_TYPES).toEqual(originalConfig.POWERUP_TYPES);
    expect(modularConfig.levelThresholds).toEqual(originalConfig.levelThresholds);

    await originalPage.close();
  });

});

test.describe('Modular vs Original Parity', () => {

  test('both versions should handle game start identically', async ({ context }) => {
    // Start both versions
    const modularPage = await context.newPage();
    const originalPage = await context.newPage();

    await modularPage.goto('/index-modular.html');
    await originalPage.goto('/');

    await waitForGameReady(modularPage);
    await waitForGameReady(originalPage);

    // Start both games
    await startGame(modularPage);
    await startGame(originalPage);

    await modularPage.waitForTimeout(100);
    await originalPage.waitForTimeout(100);

    // Compare states
    const modularState = await getGameState(modularPage);
    const originalState = await getGameState(originalPage);

    expect(modularState.gameState).toBe('playing');
    expect(originalState.gameState).toBe('playing');
    expect(modularState.lives).toBe(originalState.lives);
    expect(modularState.gameLevel).toBe(originalState.gameLevel);

    await modularPage.close();
    await originalPage.close();
  });

});
