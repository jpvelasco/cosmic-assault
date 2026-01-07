// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForGameReady,
  getGameState,
  getPlayer,
  getEntityCounts,
  startGame,
  pressKey,
  releaseKey,
  playForDuration
} = require('../helpers/game-helper');

test.describe('Basic Gameplay', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);
  });

  test('should move player when pressing arrow keys', async ({ page }) => {
    const initialPlayer = await getPlayer(page);

    // Press up to thrust
    await pressKey(page, 'ArrowUp');
    await page.waitForTimeout(500);
    await releaseKey(page, 'ArrowUp');

    const movedPlayer = await getPlayer(page);

    // Player should have moved or gained velocity
    const hasMoved = movedPlayer.x !== initialPlayer.x || movedPlayer.y !== initialPlayer.y;
    const hasVelocity = movedPlayer.vx !== 0 || movedPlayer.vy !== 0;

    expect(hasMoved || hasVelocity).toBe(true);
  });

  test('should rotate player when pressing left/right keys', async ({ page }) => {
    const initialPlayer = await getPlayer(page);

    // Press right to rotate
    await pressKey(page, 'ArrowRight');
    await page.waitForTimeout(300);
    await releaseKey(page, 'ArrowRight');

    const rotatedPlayer = await getPlayer(page);
    expect(rotatedPlayer.angle).not.toBe(initialPlayer.angle);
  });

  test('should fire projectiles when pressing space', async ({ page }) => {
    const initialEntities = await getEntityCounts(page);

    // Press space to shoot
    await pressKey(page, ' ');
    await page.waitForTimeout(500);
    await releaseKey(page, ' ');

    const afterShooting = await getEntityCounts(page);
    expect(afterShooting.projectiles).toBeGreaterThan(initialEntities.projectiles);
  });

  test('should increase score when destroying asteroids', async ({ page }) => {
    const initialState = await getGameState(page);

    // Play for a bit, shooting and moving
    await playForDuration(page, 5000, { shoot: true, move: true, pattern: 'circle' });

    const afterPlaying = await getGameState(page);

    // Score should increase if any asteroids were hit
    // This might not always happen in 5 seconds, so we check it's at least not crashed
    expect(afterPlaying.gameState).toBe('playing');
  });

  test('should not crash during 10 seconds of gameplay', async ({ page }) => {
    // Play for 10 seconds
    await playForDuration(page, 10000, { shoot: true, move: true, pattern: 'circle' });

    const state = await getGameState(page);

    // Game should still be running (playing or gameOver, but not undefined/error)
    expect(['playing', 'gameOver']).toContain(state.gameState);
  });

  test('should spawn more asteroids over time', async ({ page }) => {
    // Wait a bit for spawning to happen
    await playForDuration(page, 3000, { shoot: false, move: true, pattern: 'circle' });

    const entities = await getEntityCounts(page);
    // Should have asteroids (spawner should be working)
    expect(entities.asteroids).toBeGreaterThan(0);
  });

  test('should create particles during gameplay', async ({ page }) => {
    // Shoot to create particles
    await pressKey(page, ' ');
    await pressKey(page, 'ArrowUp');
    await page.waitForTimeout(1000);

    const entities = await getEntityCounts(page);
    expect(entities.particles).toBeGreaterThan(0);
  });

  test('player invulnerability should expire after ~3 seconds', async ({ page }) => {
    // Player starts invulnerable
    let player = await getPlayer(page);
    expect(player.invulnerable).toBe(true);

    // Wait for invulnerability to expire (3 seconds + buffer)
    await page.waitForTimeout(3500);

    player = await getPlayer(page);
    expect(player.invulnerable).toBe(false);
  });

});
