// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForGameReady,
  getGameState,
  getPlayer,
  getEntityCounts,
  startGame,
  getCanvasDimensions
} = require('../helpers/game-helper');

test.describe('Game Start', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
  });

  test('should start game when pressing any key on title screen', async ({ page }) => {
    // Verify we're on title screen
    let state = await getGameState(page);
    expect(state.gameState).toBe('title');

    // Press space to start
    await page.keyboard.press('Space');
    await page.waitForTimeout(100); // Allow state transition

    state = await getGameState(page);
    expect(state.gameState).toBe('playing');
  });

  test('should start game via test API', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const state = await getGameState(page);
    expect(state.gameState).toBe('playing');
  });

  test('should spawn player at center of screen', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const player = await getPlayer(page);
    const dimensions = await getCanvasDimensions(page);

    expect(player).not.toBeNull();
    expect(player.x).toBeCloseTo(dimensions.width / 2, 0);
    expect(player.y).toBeCloseTo(dimensions.height / 2, 0);
    expect(player.alive).toBe(true);
  });

  test('should spawn player with invulnerability', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const player = await getPlayer(page);
    expect(player.invulnerable).toBe(true);
  });

  test('should spawn initial asteroids', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const entities = await getEntityCounts(page);
    expect(entities.asteroids).toBeGreaterThanOrEqual(3); // Initial count is 3
  });

  test('should reset score when starting new game', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const state = await getGameState(page);
    expect(state.score).toBe(0);
    expect(state.lives).toBe(3);
    expect(state.gameLevel).toBe(1);
  });

  test('should start with 3 lives', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const state = await getGameState(page);
    expect(state.lives).toBe(3);
  });

  test('should start with weapon level 1', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const state = await getGameState(page);
    expect(state.weaponLevel).toBe(1);
  });

});
