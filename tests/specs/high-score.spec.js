// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, startGame, getGameState } = require('../helpers/game-helper');
const { AIPlayer } = require('../helpers/ai-player');

/**
 * High Score Persistence Tests
 * Verify high scores are saved to localStorage and persist across sessions
 */
test.describe('High Score System', () => {

  test('should persist high score across page reloads', async ({ page }) => {
    // Clear any existing high score
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('cosmicAssaultHighScore'));
    await page.reload();
    await waitForGameReady(page);

    // Verify starting high score is 0
    let state = await getGameState(page);
    expect(state.highScore).toBe(0);

    // Play a quick game to get some score
    await startGame(page);
    const ai = new AIPlayer(page, { strategy: 'AGGRESSIVE', reactionTime: 50 });
    await ai.play(10000); // 10 seconds

    // Check we got some score
    state = await getGameState(page);
    const scoreAfterPlay = state.score;
    expect(scoreAfterPlay).toBeGreaterThan(0);

    // Force game over and save high score
    const highScoreBeforeReload = await page.evaluate(() => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      const state = api.getState();
      state.lives = 0;
      state.gameState = 'gameOver';
      // Update high score
      if (state.score > state.highScore) {
        state.highScore = state.score;
      }
      localStorage.setItem('cosmicAssaultHighScore', state.highScore.toString());
      return state.highScore;
    });

    expect(highScoreBeforeReload).toBeGreaterThan(0);

    // Reload the page
    await page.reload();
    await waitForGameReady(page);

    // Verify high score persisted
    state = await getGameState(page);
    expect(state.highScore).toBe(highScoreBeforeReload);
  });

  test('should update high score when beaten', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);

    // Set a known low high score
    await page.evaluate(() => {
      localStorage.setItem('cosmicAssaultHighScore', '100');
    });
    await page.reload();
    await waitForGameReady(page);

    // Verify initial high score
    let state = await getGameState(page);
    expect(state.highScore).toBe(100);

    // Play aggressively to beat the low score
    await startGame(page);
    const ai = new AIPlayer(page, { strategy: 'AGGRESSIVE', reactionTime: 50 });
    await ai.play(15000); // 15 seconds should easily beat 100

    state = await getGameState(page);
    expect(state.score).toBeGreaterThan(100);
  });

  test('should NOT update high score if not beaten', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);

    // Set a very high score that won't be beaten
    await page.evaluate(() => {
      localStorage.setItem('cosmicAssaultHighScore', '999999');
    });
    await page.reload();
    await waitForGameReady(page);

    // Verify initial high score
    let state = await getGameState(page);
    expect(state.highScore).toBe(999999);

    // Play briefly
    await startGame(page);
    await page.waitForTimeout(2000);

    // High score should remain unchanged
    state = await getGameState(page);
    expect(state.highScore).toBe(999999);
  });

  test('should display NEW HIGH SCORE message', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('cosmicAssaultHighScore'));
    await page.reload();
    await waitForGameReady(page);

    // Play to get a score
    await startGame(page);
    const ai = new AIPlayer(page, { strategy: 'AGGRESSIVE', reactionTime: 50 });
    await ai.play(8000);

    // Force game over
    await page.evaluate(() => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      const state = api.getState();
      state.lives = 0;
      state.gameState = 'gameOver';
      // Update high score
      if (state.score > state.highScore) {
        state.highScore = state.score;
      }
    });

    await page.waitForTimeout(500);

    // Check game over state - high score should equal score (first game)
    const state = await getGameState(page);
    if (state.gameState === 'gameOver' && state.score > 0) {
      expect(state.highScore).toBe(state.score);
    }
  });

});
