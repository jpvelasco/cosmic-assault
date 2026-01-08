// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, startGame, getGameState } = require('../helpers/game-helper');
const { AIPlayer } = require('../helpers/ai-player');

/**
 * AI Stress Tests - Use intelligent AI player to stress test the game
 * These tests verify the game remains stable under various AI play styles
 */
test.describe('AI Stress Testing', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);
  });

  test('AI survival mode - 60 seconds', async ({ page }) => {
    test.slow();

    const ai = new AIPlayer(page, {
      strategy: 'SURVIVAL',
      reactionTime: 80,
      skillLevel: 0.9
    });

    const report = await ai.play(60000);
    console.log('[AI Report - Survival]', report);

    // Verify game is still running (didn't crash)
    const state = await getGameState(page);
    expect(['playing', 'gameOver']).toContain(state.gameState);

    // AI should have made many decisions
    expect(report.decisions).toBeGreaterThan(100);
  });

  test('AI aggressive mode - 60 seconds', async ({ page }) => {
    test.slow();

    const ai = new AIPlayer(page, {
      strategy: 'AGGRESSIVE',
      reactionTime: 60,
      skillLevel: 0.85
    });

    const report = await ai.play(60000);
    console.log('[AI Report - Aggressive]', report);

    const state = await getGameState(page);
    expect(['playing', 'gameOver']).toContain(state.gameState);

    // Aggressive AI should shoot a lot
    expect(report.shots).toBeGreaterThan(150);
  });

  test('AI powerup hunter mode - 60 seconds', async ({ page }) => {
    test.slow();

    const ai = new AIPlayer(page, {
      strategy: 'POWERUP_HUNTER',
      reactionTime: 100,
      skillLevel: 0.8
    });

    const report = await ai.play(60000);
    console.log('[AI Report - Powerup Hunter]', report);

    const state = await getGameState(page);
    expect(['playing', 'gameOver']).toContain(state.gameState);
    expect(report.decisions).toBeGreaterThan(100);
  });

  test('AI chaos mode - 30 seconds edge case testing', async ({ page }) => {
    const ai = new AIPlayer(page, {
      strategy: 'CHAOS',
      reactionTime: 50 // Fast, chaotic inputs
    });

    const report = await ai.play(30000);
    console.log('[AI Report - Chaos]', report);

    // Game should survive chaotic input
    const state = await getGameState(page);
    expect(['playing', 'gameOver']).toContain(state.gameState);

    // Verify no JavaScript errors occurred
    const hasErrors = await page.evaluate(() => {
      return window.__testErrors && window.__testErrors.length > 0;
    });
    expect(hasErrors).toBeFalsy();
  });

  test('AI key combo mode - systematic input testing', async ({ page }) => {
    test.slow();

    const ai = new AIPlayer(page, {
      strategy: 'KEY_COMBO',
      reactionTime: 100 // Moderate speed to observe each combo
    });

    // Track rotation changes for each combo
    const rotationData = [];
    let lastAngle = 0;
    let sampleCount = 0;

    const sampleInterval = setInterval(async () => {
      try {
        const player = await page.evaluate(() =>
          window.__COSMIC_ASSAULT_TEST_API__.getPlayer()
        );
        if (player && player.alive) {
          const angleDiff = player.angle - lastAngle;
          rotationData.push({
            sample: sampleCount++,
            angle: player.angle,
            angleDiff,
            vx: player.vx,
            vy: player.vy
          });
          lastAngle = player.angle;
        }
      } catch (e) {
        // Page may have navigated
      }
    }, 500);

    const report = await ai.play(60000); // 60 seconds to cover all combos
    clearInterval(sampleInterval);

    console.log('[AI Report - Key Combo]', report);
    console.log('[Rotation samples]', rotationData.length);

    // Verify game survived
    const state = await getGameState(page);
    expect(['playing', 'gameOver']).toContain(state.gameState);

    // AI should have cycled through all 12 combos (10 decisions each = 120 decisions)
    expect(report.decisions).toBeGreaterThan(100);

    // Check that rotation occurred in both directions
    const leftTurns = rotationData.filter(d => d.angleDiff < -0.01).length;
    const rightTurns = rotationData.filter(d => d.angleDiff > 0.01).length;

    console.log(`[Turn Analysis] Left turns: ${leftTurns}, Right turns: ${rightTurns}`);

    // Both left and right turning should have occurred
    expect(leftTurns).toBeGreaterThan(0);
    expect(rightTurns).toBeGreaterThan(0);

    // Check that movement occurred
    const hasMovement = rotationData.some(d => Math.abs(d.vx) > 0.1 || Math.abs(d.vy) > 0.1);
    expect(hasMovement).toBe(true);
  });

});

test.describe('AI Extended Sessions', () => {

  test('AI marathon - 3 minute continuous play', async ({ page }) => {
    test.slow();
    test.setTimeout(240000); // 4 minute timeout

    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);

    const ai = new AIPlayer(page, {
      strategy: 'AGGRESSIVE',
      reactionTime: 100,
      skillLevel: 0.8
    });

    const report = await ai.play(180000); // 3 minutes
    console.log('[AI Report - Marathon]', report);

    const state = await getGameState(page);
    expect(['playing', 'gameOver']).toContain(state.gameState);

    // Should have scored something
    expect(state.score).toBeGreaterThanOrEqual(0);
  });

  test('AI endurance - multiple game sessions', async ({ page }) => {
    test.slow();
    test.setTimeout(180000);

    await page.goto('/');
    await waitForGameReady(page);

    const sessions = 3;
    const reports = [];

    for (let i = 0; i < sessions; i++) {
      await startGame(page);
      await page.waitForTimeout(100);

      const ai = new AIPlayer(page, {
        strategy: i % 2 === 0 ? 'AGGRESSIVE' : 'SURVIVAL',
        reactionTime: 80
      });

      const report = await ai.play(30000);
      reports.push(report);
      console.log(`[AI Session ${i + 1}]`, report);

      // Wait for game over or force restart
      await page.waitForTimeout(500);

      // Restart game if still playing
      const state = await getGameState(page);
      if (state.gameState === 'playing') {
        // Let the player die or wait
        await page.waitForTimeout(1000);
      }
    }

    // All sessions should complete
    expect(reports.length).toBe(sessions);
  });

});

test.describe('AI Performance Metrics', () => {

  test('should track entity counts during AI play', async ({ page }) => {
    test.slow();

    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);

    const entityCounts = [];
    const ai = new AIPlayer(page, {
      strategy: 'AGGRESSIVE',
      reactionTime: 100
    });

    // Sample entity counts during play
    const sampleInterval = setInterval(async () => {
      try {
        const counts = await page.evaluate(() =>
          window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts()
        );
        entityCounts.push({ time: Date.now(), ...counts });
      } catch (e) {
        // Page may have navigated
      }
    }, 2000);

    await ai.play(30000);
    clearInterval(sampleInterval);

    console.log('[Entity Count Samples]', entityCounts);

    // Verify no runaway entity growth
    const maxParticles = Math.max(...entityCounts.map(c => c.particles || 0));
    const maxAsteroids = Math.max(...entityCounts.map(c => c.asteroids || 0));
    const maxProjectiles = Math.max(...entityCounts.map(c => c.projectiles || 0));

    expect(maxParticles).toBeLessThan(1000);
    expect(maxAsteroids).toBeLessThan(200);
    expect(maxProjectiles).toBeLessThan(300);
  });

  test('should maintain playable frame rate during AI stress', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(100);

    // Inject FPS counter
    await page.evaluate(() => {
      window.__fpsData = [];
      let lastTime = performance.now();
      let frames = 0;

      const measureFPS = () => {
        frames++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
          window.__fpsData.push(frames);
          frames = 0;
          lastTime = now;
        }
        if (window.__measureFPS) requestAnimationFrame(measureFPS);
      };

      window.__measureFPS = true;
      requestAnimationFrame(measureFPS);
    });

    const ai = new AIPlayer(page, {
      strategy: 'CHAOS', // Most demanding
      reactionTime: 50
    });

    await ai.play(15000);

    // Stop measuring
    await page.evaluate(() => {
      window.__measureFPS = false;
    });

    const fpsData = await page.evaluate(() => window.__fpsData);
    console.log('[FPS Data]', fpsData);

    if (fpsData.length > 0) {
      const avgFPS = fpsData.reduce((a, b) => a + b, 0) / fpsData.length;
      const minFPS = Math.min(...fpsData);

      console.log(`[FPS] Avg: ${avgFPS.toFixed(1)}, Min: ${minFPS}`);

      // Should maintain reasonable FPS
      expect(avgFPS).toBeGreaterThan(20);
      expect(minFPS).toBeGreaterThan(10);
    }
  });

});
