// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, startGame, getGameState, getPlayer } = require('../helpers/game-helper');

/**
 * Gravity Field Tests
 * COSMO investigates the gravity zones bug
 */
test.describe('Gravity Field Investigation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await startGame(page);
    await page.waitForTimeout(500);
  });

  test('COSMO: should spawn gravity field via test API', async ({ page }) => {
    // Get initial state
    const initialCounts = await page.evaluate(() =>
      window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts()
    );
    console.log('[COSMO] Initial entity counts:', initialCounts);

    // Spawn a gravity field near player
    const player = await getPlayer(page);
    const fieldData = await page.evaluate((playerX) => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      return api.spawnGravityField(playerX + 100, 360, 150, 1.0);
    }, player.x);

    console.log('[COSMO] Spawned gravity field:', fieldData);

    // Verify it was created
    const afterCounts = await page.evaluate(() =>
      window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts()
    );
    console.log('[COSMO] After spawn counts:', afterCounts);

    expect(afterCounts.gravityFields).toBe(initialCounts.gravityFields + 1);
  });

  test('COSMO: should verify gravity field affects player velocity', async ({ page }) => {
    // Get initial player state
    const initial = await getPlayer(page);
    console.log('[COSMO] Initial player - x:', initial.x, 'y:', initial.y, 'vx:', initial.vx, 'vy:', initial.vy);

    // Spawn a strong PULL field to the right of player
    await page.evaluate(({px, py}) => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      // Spawn field 80px to the right of player (within the 150px radius)
      api.spawnGravityField(px + 80, py, 150, 1.0);
    }, {px: initial.x, py: initial.y});

    // Wait for gravity to affect player over multiple frames
    await page.waitForTimeout(1000);

    const after = await getPlayer(page);
    console.log('[COSMO] After 1s - x:', after.x, 'y:', after.y, 'vx:', after.vx, 'vy:', after.vy);

    const velocityChange = Math.abs(after.vx - initial.vx) + Math.abs(after.vy - initial.vy);
    console.log('[COSMO] Velocity change magnitude:', velocityChange);

    // If gravity is working, player should have been pulled right (positive vx change)
    // Or at minimum, position should have changed
    const positionChange = Math.abs(after.x - initial.x) + Math.abs(after.y - initial.y);
    console.log('[COSMO] Position change:', positionChange);

    // DIAGNOSIS: If this fails, gravity is NOT being applied
    if (velocityChange < 0.1 && positionChange < 5) {
      console.log('[COSMO] ⚠️ GRAVITY NOT WORKING - velocity and position unchanged!');
    }
  });

  test('COSMO: should test repulsion field (negative strength)', async ({ page }) => {
    const initial = await getPlayer(page);
    console.log('[COSMO] Initial player pos:', initial.x, initial.y);

    // Spawn a PUSH field (negative strength) to the right of player
    await page.evaluate(({px, py}) => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      api.spawnGravityField(px + 80, py, 150, -1.0); // Negative = repulsion
    }, {px: initial.x, py: initial.y});

    await page.waitForTimeout(1000);

    const after = await getPlayer(page);
    console.log('[COSMO] After 1s:', after.x, after.y, 'vx:', after.vx);

    // Repulsion should push player LEFT (negative vx change or x decreased)
    // Since field is to the right, repulsion should push player left
    console.log('[COSMO] X change:', after.x - initial.x, '(expected negative for repulsion)');
  });

  test('COSMO: should verify getGravityFields returns correct data', async ({ page }) => {
    // Spawn multiple fields
    await page.evaluate(() => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      api.spawnGravityField(200, 200, 100, 1.0);  // Pull
      api.spawnGravityField(500, 300, 120, -0.5); // Push
    });

    const fields = await page.evaluate(() =>
      window.__COSMIC_ASSAULT_TEST_API__.getGravityFields()
    );

    console.log('[COSMO] Gravity fields:', JSON.stringify(fields, null, 2));

    expect(fields.length).toBe(2);
    expect(fields[0].isPull).toBe(true);
    expect(fields[1].isPull).toBe(false);
  });

  test('COSMO: should check if gravity fields spawn naturally at high level', async ({ page }) => {
    // Set game to level 5 where gravity fields should spawn more often
    await page.evaluate(() => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      api.setGameLevel(5);
    });

    const initialCounts = await page.evaluate(() =>
      window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts()
    );
    console.log('[COSMO] At level 5, initial gravity fields:', initialCounts.gravityFields);

    // Wait for natural spawning (spawn chance increases with level)
    await page.waitForTimeout(10000);

    const afterCounts = await page.evaluate(() =>
      window.__COSMIC_ASSAULT_TEST_API__.getEntityCounts()
    );
    console.log('[COSMO] After 10s at level 5, gravity fields:', afterCounts.gravityFields);

    // At level 5, spawn chance is (0.001 + 3*0.0005) = 0.0025 per frame
    // At 60fps, that's about 0.15 per second, so after 10s we'd expect ~1.5 fields
    // But max is 2, so we should see at least 1
  });

  test('COSMO: deep dive - trace gravity application frame by frame', async ({ page }) => {
    const initial = await getPlayer(page);

    // Spawn field
    const fieldInfo = await page.evaluate(({px, py}) => {
      const api = window.__COSMIC_ASSAULT_TEST_API__;
      return api.spawnGravityField(px + 60, py, 200, 2.0); // Very strong, close
    }, {px: initial.x, py: initial.y});

    console.log('[COSMO] Field spawned at:', fieldInfo.x, fieldInfo.y);
    console.log('[COSMO] Player at:', initial.x, initial.y);
    console.log('[COSMO] Distance:', Math.sqrt(Math.pow(fieldInfo.x - initial.x, 2) + Math.pow(fieldInfo.y - initial.y, 2)));

    // Sample velocity every 100ms
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100);
      const p = await getPlayer(page);
      samples.push({ time: i * 100, x: p.x, vx: p.vx, vy: p.vy });
    }

    console.log('[COSMO] Velocity samples over 1 second:');
    samples.forEach(s => console.log(`  ${s.time}ms: x=${s.x.toFixed(1)}, vx=${s.vx.toFixed(3)}, vy=${s.vy.toFixed(3)}`));

    // Check if velocity is changing
    const vxChanges = samples.slice(1).map((s, i) => s.vx - samples[i].vx);
    const avgVxChange = vxChanges.reduce((a, b) => a + b, 0) / vxChanges.length;
    console.log('[COSMO] Average vx change per sample:', avgVxChange.toFixed(5));

    if (Math.abs(avgVxChange) < 0.001) {
      console.log('[COSMO] ⚠️ DIAGNOSIS: Gravity is NOT being applied - vx not changing!');
    }
  });

});
