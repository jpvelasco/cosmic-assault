import { beforeAll, describe, expect, it } from 'vitest';
import type { RunResult } from '../../src/bot/run';
import { BOT_RUN_TIMEOUT_MS, botRuns } from '../helpers/botRuns';

const total = (results: readonly RunResult[], field: 'livesLost' | 'score' | 'time'): number => results.reduce((sum, r) => sum + r[field], 0);

// 2-3 has drones and a gravity well, and is hard enough that an idle ship loses nearly every run while the expert loses
// almost nothing: the casual must land between the two (Ruling R24).
describe('the casual bot on 2-3', { timeout: BOT_RUN_TIMEOUT_MS }, () => {
  let casual: RunResult[] = [];
  beforeAll(() => {
    casual = botRuns('2-3', 'casual');
  }, BOT_RUN_TIMEOUT_MS);

  it('loses more lives than the expert', () => {
    expect(total(casual, 'livesLost')).toBeGreaterThan(total(botRuns('2-3', 'expert'), 'livesLost'));
  });

  it('scores more, and survives longer, than an idle ship', () => {
    const statue = botRuns('2-3', 'statue');
    expect(total(casual, 'score')).toBeGreaterThan(total(statue, 'score'));
    expect(total(casual, 'time')).toBeGreaterThan(total(statue, 'time'));
  });
});
