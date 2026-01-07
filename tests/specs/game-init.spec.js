// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForGameReady,
  getGameState,
  getConfig,
  getCanvasDimensions
} = require('../helpers/game-helper');

test.describe('Game Initialization', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
  });

  test('should load and display title screen', async ({ page }) => {
    const state = await getGameState(page);

    expect(state.gameState).toBe('title');
    expect(state.score).toBe(0);
    expect(state.lives).toBe(3);
    expect(state.gameLevel).toBe(1);
  });

  test('should have canvas element visible', async ({ page }) => {
    const canvas = await page.locator('#gameCanvas');
    await expect(canvas).toBeVisible();
  });

  test('should initialize with correct default values', async ({ page }) => {
    const state = await getGameState(page);

    expect(state.score).toBe(0);
    expect(state.lives).toBe(3);
    expect(state.gameLevel).toBe(1);
    expect(state.scoreMultiplier).toBe(1);
    expect(state.weaponLevel).toBe(1);
    expect(state.meteorShowerActive).toBe(false);
    expect(state.bonusRoundActive).toBe(false);
  });

  test('should have canvas sized to viewport', async ({ page }) => {
    const dimensions = await getCanvasDimensions(page);
    const viewport = page.viewportSize();

    expect(dimensions.width).toBe(viewport.width);
    expect(dimensions.height).toBe(viewport.height);
  });

  test('should expose test API with correct version', async ({ page }) => {
    const version = await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.version);
    // Version 2.0.0 = modular architecture
    expect(version).toBe('2.0.0');
  });

  test('should have correct powerup types configured', async ({ page }) => {
    const config = await getConfig(page);

    expect(config.POWERUP_TYPES).toContain('doubleShot');
    expect(config.POWERUP_TYPES).toContain('rapidFire');
    expect(config.POWERUP_TYPES).toContain('shield');
    expect(config.POWERUP_TYPES).toContain('fieldBomb');
  });

  test('should have level thresholds defined', async ({ page }) => {
    const config = await getConfig(page);

    expect(config.levelThresholds).toBeDefined();
    expect(config.levelThresholds.length).toBeGreaterThan(1);
    expect(config.levelThresholds[0]).toBe(0); // First threshold is 0
  });

});
