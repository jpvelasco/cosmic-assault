/**
 * Game Helper - Utility functions for interacting with Cosmic Assault via Test API
 */

/**
 * Wait for the game's test API to be ready
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout
 */
async function waitForGameReady(page, timeout = 10000) {
  await page.waitForFunction(
    () => window.__COSMIC_ASSAULT_TEST_API_READY__ === true &&
          window.__COSMIC_ASSAULT_TEST_API__?.isReady(),
    { timeout }
  );
}

/**
 * Get the current game state
 * @param {import('@playwright/test').Page} page
 */
async function getGameState(page) {
  return await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getState());
}

/**
 * Get player information
 * @param {import('@playwright/test').Page} page
 */
async function getPlayer(page) {
  return await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getPlayer());
}

/**
 * Get entity counts (asteroids, projectiles, etc.)
 * @param {import('@playwright/test').Page} page
 */
async function getEntityCounts(page) {
  return await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts());
}

/**
 * Get all asteroids
 * @param {import('@playwright/test').Page} page
 */
async function getAsteroids(page) {
  return await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getAsteroids());
}

/**
 * Get all powerups
 * @param {import('@playwright/test').Page} page
 */
async function getPowerups(page) {
  return await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getPowerups());
}

/**
 * Get game configuration constants
 * @param {import('@playwright/test').Page} page
 */
async function getConfig(page) {
  return await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getConfig());
}

/**
 * Get canvas dimensions
 * @param {import('@playwright/test').Page} page
 */
async function getCanvasDimensions(page) {
  return await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.getCanvasDimensions());
}

/**
 * Start the game (from title or game over screen)
 * @param {import('@playwright/test').Page} page
 */
async function startGame(page) {
  await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.startGame());
}

/**
 * Simulate pressing a key
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 */
async function pressKey(page, key) {
  await page.evaluate((k) => window.__COSMIC_ASSAULT_TEST_API__.simulateKeyDown(k), key);
}

/**
 * Simulate releasing a key
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 */
async function releaseKey(page, key) {
  await page.evaluate((k) => window.__COSMIC_ASSAULT_TEST_API__.simulateKeyUp(k), key);
}

/**
 * Simulate pressing and releasing a key
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 * @param {number} durationMs
 */
async function tapKey(page, key, durationMs = 100) {
  await page.evaluate(
    ({ k, d }) => window.__COSMIC_ASSAULT_TEST_API__.simulateKeyPress(k, d),
    { k: key, d: durationMs }
  );
}

/**
 * Simulate joystick input (for mobile testing)
 * @param {import('@playwright/test').Page} page
 * @param {number} angle - Angle in radians
 * @param {number} distance - Distance from center (0-60 typically)
 */
async function setJoystick(page, angle, distance) {
  await page.evaluate(
    ({ a, d }) => window.__COSMIC_ASSAULT_TEST_API__.simulateJoystick(a, d),
    { a: angle, d: distance }
  );
}

/**
 * Release joystick
 * @param {import('@playwright/test').Page} page
 */
async function releaseJoystick(page) {
  await page.evaluate(() => window.__COSMIC_ASSAULT_TEST_API__.releaseJoystick());
}

/**
 * Wait for a specific game state
 * @param {import('@playwright/test').Page} page
 * @param {string} targetState
 * @param {number} timeout
 */
async function waitForState(page, targetState, timeout = 5000) {
  await page.evaluate(
    ({ state, ms }) => window.__COSMIC_ASSAULT_TEST_API__.waitForState(state, ms),
    { state: targetState, ms: timeout }
  );
}

/**
 * Wait for a condition to be true
 * @param {import('@playwright/test').Page} page
 * @param {string} conditionCode - JavaScript code that returns a boolean
 * @param {number} timeout
 */
async function waitForCondition(page, conditionCode, timeout = 5000) {
  await page.waitForFunction(conditionCode, { timeout });
}

/**
 * Play the game for a duration by holding movement keys and shooting
 * @param {import('@playwright/test').Page} page
 * @param {number} durationMs
 * @param {object} options
 */
async function playForDuration(page, durationMs, options = {}) {
  const { shoot = true, move = true, pattern = 'circle' } = options;

  const startTime = Date.now();
  const patternInterval = 500; // Change direction every 500ms for circle pattern

  // Start shooting if enabled
  if (shoot) {
    await pressKey(page, ' ');
  }

  while (Date.now() - startTime < durationMs) {
    if (move) {
      const elapsed = Date.now() - startTime;
      const phase = Math.floor(elapsed / patternInterval) % 4;

      // Release all movement keys
      await releaseKey(page, 'ArrowUp');
      await releaseKey(page, 'ArrowLeft');
      await releaseKey(page, 'ArrowRight');

      if (pattern === 'circle') {
        // Move in a circular pattern
        switch (phase) {
          case 0:
            await pressKey(page, 'ArrowUp');
            await pressKey(page, 'ArrowRight');
            break;
          case 1:
            await pressKey(page, 'ArrowUp');
            break;
          case 2:
            await pressKey(page, 'ArrowUp');
            await pressKey(page, 'ArrowLeft');
            break;
          case 3:
            await pressKey(page, 'ArrowUp');
            break;
        }
      } else if (pattern === 'random') {
        // Random movement
        if (Math.random() > 0.3) await pressKey(page, 'ArrowUp');
        if (Math.random() > 0.5) await pressKey(page, Math.random() > 0.5 ? 'ArrowLeft' : 'ArrowRight');
      }
    }

    // Small delay to allow game to update
    await page.waitForTimeout(100);
  }

  // Release all keys
  await releaseKey(page, ' ');
  await releaseKey(page, 'ArrowUp');
  await releaseKey(page, 'ArrowLeft');
  await releaseKey(page, 'ArrowRight');
}

/**
 * Take a screenshot of the canvas
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function screenshotCanvas(page, name) {
  const canvas = await page.locator('#gameCanvas');
  await canvas.screenshot({ path: `./screenshots/${name}.png` });
}

/**
 * Dismiss the fullscreen prompt if visible
 * @param {import('@playwright/test').Page} page
 */
async function dismissFullscreenPrompt(page) {
  const skipButton = page.locator('#skip-fullscreen');
  if (await skipButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await skipButton.click();
    await page.waitForTimeout(200);
  }
}

module.exports = {
  waitForGameReady,
  getGameState,
  getPlayer,
  getEntityCounts,
  getAsteroids,
  getPowerups,
  getConfig,
  getCanvasDimensions,
  startGame,
  pressKey,
  releaseKey,
  tapKey,
  setJoystick,
  releaseJoystick,
  waitForState,
  waitForCondition,
  playForDuration,
  screenshotCanvas,
  dismissFullscreenPrompt
};
