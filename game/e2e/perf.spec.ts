import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import type { GalaxyId } from '../src/content/types';
import { IDLE_SETTLE_MS, IDLE_WINDOW_MS } from '../src/render/quality';
import { expect, fastForward, gameState, openGame, restartFrameStats, test } from './fixtures';
import { frameReport, PERF_CEILINGS, type PerfScene } from './perfThresholds';
import { CARRIER_GALAXY, PERF_FIGHT_HOLD_SECONDS, PERF_FIGHT_LIVES, PERF_GALAXY, PERF_HOLD_SECONDS, PERF_SETTLE_SECONDS, seedFor, TO_BOSS_FIGHT_SECONDS, type ClaimId } from './seeds';

const CPU_SLOWDOWN = 4;
/** The target for a throttled phone-class CPU; recorded in perf.json, not asserted: the ceilings in perfThresholds.ts are. */
const BUDGET_P95_MS = 33;
const REPORT_PATH = 'test-results/perf.json';
/**
 * Ms the case idles on its first screen before play, so the quality scaler measures the display's frame interval there
 * (it skips IDLE_SETTLE_MS, then keeps the fastest IDLE_WINDOW_MS window): the interval a slow frame is judged against.
 */
const IDLE_MS = IDLE_SETTLE_MS + 2 * IDLE_WINDOW_MS;

/**
 * One measured scene: where it plays, the sim seconds skipped so it opens mid-scene, and how long it is measured. A
 * skipped scene is played for PERF_SETTLE_SECONDS before its frame stats restart, so the quality level has stepped
 * down to it first.
 */
interface PerfCase {
  readonly name: PerfScene;
  readonly galaxy: GalaxyId;
  readonly claim: ClaimId;
  readonly skipSeconds: number;
  readonly holdSeconds: number;
  readonly lives?: number;
}

const CASES: readonly PerfCase[] = [
  // A galaxy opens on an empty field, so the hold runs long enough for it to fill. Over this hold, with the ship firing
  // and turning, 60 seeds of each Dimension 3 to 5 survival galaxy average 2.5 (5-5) to 4.4 (4-3) rocks, foes and bolts
  // on the field; the 'busy-field' seed averages 5.7, as busy as the busiest of them, ends with 14 rocks, and sees a warp
  // rift open. 5-5, the last, is the sparsest: its black hole swallows rocks from 12 s on.
  // So a later galaxy would measure less, not more.
  { name: 'field', galaxy: PERF_GALAXY, claim: 'busy-field', skipSeconds: 0, holdSeconds: PERF_HOLD_SECONDS },
  // Every measured frame is the Hive Carrier's fight: drones, broadside rocks and the hangar opening and shutting.
  { name: 'bossFight', galaxy: CARRIER_GALAXY, claim: 'carrier-fight', skipSeconds: TO_BOSS_FIGHT_SECONDS, holdSeconds: PERF_FIGHT_HOLD_SECONDS, lives: PERF_FIGHT_LIVES },
];

/** Every case's report, written to REPORT_PATH once the file's cases have run. */
const reports: Record<string, unknown> = {};

test.afterAll(() => {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify({ cpuSlowdown: CPU_SLOWDOWN, budgetP95Ms: BUDGET_P95_MS, cases: reports }, null, 2)}\n`);
});

/**
 * Idles on the first screen while the display's interval is measured, starts the case's run and skips ahead, settling
 * there, then holds fire and a left turn while it measures, and returns the run's state.
 */
async function hold(page: Page, { galaxy, claim, skipSeconds, holdSeconds, lives }: PerfCase): Promise<CosmicAssaultTestState> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  await openGame(page, { seed: seedFor(claim), galaxy, ...(lives === undefined ? {} : { lives }) });
  await page.waitForTimeout(IDLE_MS);

  await page.keyboard.press('Space');
  await page.keyboard.up('Space');
  await expect.poll(async () => (await gameState(page)).mode).toBe('playing');
  if (skipSeconds > 0) await fastForward(page, skipSeconds);

  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowLeft');
  if (skipSeconds > 0) {
    await page.waitForTimeout(PERF_SETTLE_SECONDS * 1000);
    await restartFrameStats(page);
  }
  await page.waitForTimeout(holdSeconds * 1000);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Space');
  return gameState(page);
}

for (const perfCase of CASES) {
  test(`frame time under a 4x CPU slowdown, ${perfCase.name} in ${perfCase.galaxy}, within its calibrated ceilings`, async ({ page }) => {
    test.setTimeout((perfCase.holdSeconds + PERF_SETTLE_SECONDS) * 1000 + IDLE_MS + 40000);
    const { frameStats, quality, mode, asteroidCount, foes, boss } = await hold(page, perfCase);
    const report = {
      galaxy: perfCase.galaxy,
      seed: seedFor(perfCase.claim),
      settleMs: perfCase.skipSeconds > 0 ? PERF_SETTLE_SECONDS * 1000 : 0,
      holdMs: perfCase.holdSeconds * 1000,
      runEnded: mode === 'gameOver',
      asteroidsAtEnd: asteroidCount,
      foesAtEnd: foes.length,
      bossAtEnd: boss === null ? null : { state: boss.state, phase: boss.phase, hp: boss.hp },
      withinBudget: frameStats.p95 <= BUDGET_P95_MS,
      ...frameReport(frameStats, PERF_CEILINGS[perfCase.name]),
      finalQuality: quality,
    };
    reports[perfCase.name] = report;
    console.log(`perf ${perfCase.name}: ${JSON.stringify(report)}`);

    expect(frameStats.count, 'measured frames (a run past its 3 s warm-up)').toBeGreaterThan(0);
    expect(mode, 'the scene ends in play: a game over would measure the end card').toBe('playing');
    expect(report.breaches, 'the frame-time ceilings the scene is over').toEqual([]);
  });
}
