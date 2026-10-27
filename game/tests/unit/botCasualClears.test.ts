import { describe, expect, it } from 'vitest';
import { BOT_RUN_TIMEOUT_MS, botRuns, clears } from '../helpers/botRuns';

describe('the casual bot', { timeout: BOT_RUN_TIMEOUT_MS }, () => {
  it('clears 1-1 on at least 7 seeds in 10', () => {
    expect(clears(botRuns('1-1', 'casual'))).toBeGreaterThanOrEqual(7);
  });
});
