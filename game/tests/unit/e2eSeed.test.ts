import { describe, expect, it } from 'vitest';
import { E2E_SEED } from '../../e2e/seed';
import { clearSeeds, LANES, lanesStayClear } from '../helpers/e2eLanes';

describe('E2E_SEED', () => {
  it.each(LANES)('keeps asteroids out of the $name firing lane', (lane) => {
    expect(
      lanesStayClear(E2E_SEED, lane),
      `seed ${String(E2E_SEED)}'s asteroid layout now crosses the e2e firing lanes because spawning or RNG consumption changed; list replacements with "E2E_SEED_SCAN=0-300 npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose" (from game/), set E2E_SEED in game/e2e/seed.ts to the lowest seed it prints, then rerun this test`,
    ).toBe(true);
  });

  // Developer tool, not a check: E2E_SEED_SCAN=<from>-<to> prints the seeds in [from, to) that clear every lane.
  const scan = /^(\d+)-(\d+)$/.exec(process.env['E2E_SEED_SCAN'] ?? '');
  it.runIf(scan)('scan: seeds that keep every lane clear', () => {
    const [from, to] = [Number(scan?.[1]), Number(scan?.[2])];
    console.log(`seeds in [${String(from)}, ${String(to)}) that clear every lane: ${clearSeeds(from, to).join(', ') || 'none'}`);
  });
});
