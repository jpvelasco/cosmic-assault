// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForGameReady,
  getGameState,
  getEntityCounts,
  startGame,
  playForDuration,
  getConfig
} = require('../helpers/game-helper');

test.describe('Game Progression', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);
  });

  test('should start at level 1', async ({ page }) => {
    const state = await getGameState(page);
    expect(state.gameLevel).toBe(1);
    expect(state.scoreMultiplier).toBe(1);
  });

  test('should have correct level thresholds', async ({ page }) => {
    const config = await getConfig(page);

    // Verify known thresholds from source
    expect(config.levelThresholds[0]).toBe(0);
    expect(config.levelThresholds[1]).toBe(5000);
    expect(config.levelThresholds[2]).toBe(15000);
    expect(config.levelThresholds[3]).toBe(30000);
  });

  test('should spawn asteroids continuously', async ({ page }) => {
    // Move around without shooting to let asteroids accumulate
    await playForDuration(page, 5000, { shoot: false, move: true });

    const entities = await getEntityCounts(page);
    expect(entities.asteroids).toBeGreaterThan(3); // More than initial spawn
  });

  test('should handle game over gracefully', async ({ page }) => {
    // This is a stability test - game shouldn't crash even under stress
    await playForDuration(page, 30000, { shoot: true, move: true, pattern: 'circle' });

    const state = await getGameState(page);
    // Should be either still playing or game over (not crashed)
    expect(['playing', 'gameOver']).toContain(state.gameState);
  });

});

test.describe('Score System', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);
  });

  test('should start with score of 0', async ({ page }) => {
    const state = await getGameState(page);
    expect(state.score).toBe(0);
  });

  test('should have high score tracking', async ({ page }) => {
    const state = await getGameState(page);
    expect(state.highScore).toBeDefined();
    expect(typeof state.highScore).toBe('number');
  });

});

test.describe('Powerup System', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);
  });

  test('should have all powerup types configured', async ({ page }) => {
    const config = await getConfig(page);

    expect(config.POWERUP_TYPES).toEqual(['doubleShot', 'rapidFire', 'shield', 'fieldBomb']);
  });

  test('should have powerup durations configured', async ({ page }) => {
    const config = await getConfig(page);

    expect(config.POWERUP_CONFIG.doubleShot.duration).toBe(10);
    expect(config.POWERUP_CONFIG.rapidFire.duration).toBe(10);
    expect(config.POWERUP_CONFIG.shield.duration).toBe(15);
    expect(config.POWERUP_CONFIG.fieldBomb.duration).toBe(0); // Instant
  });

  test('should start with no active powerups', async ({ page }) => {
    const state = await getGameState(page);

    expect(state.activePowerups).toEqual({});
    expect(state.powerupTimers).toEqual({});
  });

});
