import { describe, expect, it } from 'vitest';
import { BOSS_APPROACH_SECONDS, BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { BOT_RUN_TIMEOUT_MS, botRuns } from '../helpers/botRuns';

const LIMIT_SECONDS = 120;

describe('the expert bot against a boss', { timeout: BOT_RUN_TIMEOUT_MS }, () => {
  it('kills the Sentinel on 3-6 within 120 s of its arrival on at least 9 seeds in 10', () => {
    const results = botRuns('3-6', 'expert', BOSS_APPROACH_SECONDS + BOSS_INTRO_SECONDS + LIMIT_SECONDS);
    const kills = results.filter((r) => r.cleared && r.bossKillTime !== undefined && r.bossKillTime <= LIMIT_SECONDS);
    expect(kills.length).toBeGreaterThanOrEqual(9);
  });
});
