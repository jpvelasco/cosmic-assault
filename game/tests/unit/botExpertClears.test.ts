import { describe, expect, it } from 'vitest';
import { BOT_RUN_TIMEOUT_MS, BOT_SEEDS, botRuns, clears } from '../helpers/botRuns';

// The slower clear rates run in the balance suite (tests/balance); this smoke test keeps the expert honest in `npm test`.
describe('the expert bot', { timeout: BOT_RUN_TIMEOUT_MS }, () => {
  it('clears 1-1 on every seed', () => {
    expect(clears(botRuns('1-1', 'expert'))).toBe(BOT_SEEDS.length);
  }, BOT_RUN_TIMEOUT_MS);
});
