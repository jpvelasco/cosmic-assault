import { describe, expect, it } from 'vitest';
import type { GalaxyId } from '../../src/content/types';
import { BOT_RUN_TIMEOUT_MS, botRuns, clears } from '../helpers/botRuns';

describe('the expert bot', { timeout: BOT_RUN_TIMEOUT_MS }, () => {
  it.each<GalaxyId>(['1-3', '2-4'])('clears %s on at least 8 seeds in 10', (id) => {
    expect(clears(botRuns(id, 'expert'))).toBeGreaterThanOrEqual(8);
  });
});
