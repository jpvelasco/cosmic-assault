import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, gameState, openGame, test } from './fixtures';
import { PERF_GALAXY, seedFor } from './seeds';

const CPU_SLOWDOWN = 4;
const PERF_SEED = seedFor('busy-field');
/** A galaxy opens on an empty field, so the hold runs long enough for it to fill. */
const HOLD_MS = 20000;
/** The target for a throttled phone-class CPU; recorded in perf.json, not asserted in M2. */
const BUDGET_P95_MS = 33;
/**
 * A catastrophic-regression guard, not a target. Headless software raster puts p95 near the
 * 3-vsync (50 ms) boundary even when nothing is wrong, so a tighter ceiling is just noise.
 */
const SANITY_P95_MS = 100;
const REPORT_PATH = 'test-results/perf.json';

test('frame time under a 4x CPU slowdown (report only)', async ({ page }) => {
  test.setTimeout(HOLD_MS + 40000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  await openGame(page, { seed: PERF_SEED, galaxy: PERF_GALAXY });

  await page.keyboard.press('Space');
  await page.keyboard.up('Space');
  await expect.poll(async () => (await gameState(page)).mode).toBe('playing');

  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Space');

  const { frameStats, quality, mode, asteroidCount } = await gameState(page);
  const report = {
    cpuSlowdown: CPU_SLOWDOWN,
    galaxy: PERF_GALAXY,
    seed: PERF_SEED,
    holdMs: HOLD_MS,
    runEnded: mode === 'gameOver',
    asteroidsAtEnd: asteroidCount,
    budgetP95Ms: BUDGET_P95_MS,
    withinBudget: frameStats.p95 <= BUDGET_P95_MS,
    ...frameStats,
    finalQuality: quality,
  };
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`perf: ${JSON.stringify(report)}`);

  expect(frameStats.count, 'measured frames (a run past its 3 s warm-up)').toBeGreaterThan(0);
  expect(frameStats.p95, `p95 frame ms vs the ${String(SANITY_P95_MS)} ms sanity ceiling`).toBeLessThan(SANITY_P95_MS);
});
