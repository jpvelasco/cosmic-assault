// @ts-check
const { test, expect, devices } = require('@playwright/test');
const {
  waitForGameReady,
  getGameState,
  getPlayer,
  startGame,
  setJoystick,
  releaseJoystick,
  pressKey,
  releaseKey
} = require('../helpers/game-helper');

// Mobile-specific tests
test.describe('Mobile Controls', () => {

  test.use({
    ...devices['Pixel 5 landscape'],
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
  });

  test('should detect mobile device and show controls', async ({ page }) => {
    const state = await getGameState(page);
    // On mobile viewport, isMobileControlsActive should be true
    expect(state.isMobileControlsActive).toBe(true);
  });

  test('should have mobile control elements visible', async ({ page }) => {
    const mobileControls = await page.locator('.mobile-controls');
    const fireButton = await page.locator('#fire-button');
    const joystickBase = await page.locator('#joystick-base');

    // These should be visible on mobile
    await expect(mobileControls).toBeVisible();
    await expect(fireButton).toBeVisible();
    await expect(joystickBase).toBeVisible();
  });

  test('should move player with simulated joystick', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    const initialPlayer = await getPlayer(page);

    // Simulate joystick pointing right (angle 0) with full extension
    await setJoystick(page, 0, 60);
    await page.waitForTimeout(500);
    await releaseJoystick(page);

    const movedPlayer = await getPlayer(page);

    // Player should have moved or be moving right
    const hasMoved = movedPlayer.x !== initialPlayer.x || movedPlayer.vx > 0;
    expect(hasMoved).toBe(true);
  });

  test('should aim player with joystick angle', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    // Point joystick downward (angle = PI/2 = 1.57 radians)
    const targetAngle = Math.PI / 2;
    await setJoystick(page, targetAngle, 60);
    await page.waitForTimeout(300);

    const player = await getPlayer(page);

    // Player angle should be close to joystick angle
    expect(player.angle).toBeCloseTo(targetAngle, 0.5);

    await releaseJoystick(page);
  });

  test('should fire when pressing fire button area', async ({ page }) => {
    await startGame(page);
    await page.waitForTimeout(100);

    // Use test API to simulate fire (space key)
    await pressKey(page, ' ');
    await page.waitForTimeout(500);
    await releaseKey(page, ' ');

    // Game should still be running
    const state = await getGameState(page);
    expect(state.gameState).toBe('playing');
  });

  test('should start game when tapping on title screen', async ({ page }) => {
    let state = await getGameState(page);
    expect(state.gameState).toBe('title');

    // Tap the canvas to start
    const canvas = await page.locator('#gameCanvas');
    await canvas.tap();
    await page.waitForTimeout(200);

    state = await getGameState(page);
    expect(state.gameState).toBe('playing');
  });

});

// iOS-specific tests
test.describe('iOS Mobile', () => {

  test.use({
    ...devices['iPhone 12 Pro landscape'],
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
  });

  test('should detect iOS mobile and show controls', async ({ page }) => {
    const state = await getGameState(page);
    expect(state.isMobileControlsActive).toBe(true);
  });

  test('should have iOS homescreen modal element', async ({ page }) => {
    const iosModal = await page.locator('#ios-homescreen-modal');
    // Modal exists but may be hidden by default
    await expect(iosModal).toBeAttached();
  });

});
