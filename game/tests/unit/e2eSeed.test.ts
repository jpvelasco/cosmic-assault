import { describe, expect, it } from 'vitest';
import { E2E_SEED, GAME_OVER_SEED } from '../../e2e/seed';
import { clearSeeds, gameOverSeeds, idleDeathSeconds, LANES, lanesStayClear, MAX_DEATH_SECONDS } from '../helpers/e2eLanes';

const SCAN_HINT =
  'list replacements with "E2E_SEED_SCAN=0-300 npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose" (from game/; PowerShell: $env:E2E_SEED_SCAN=\'0-300\'; npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose)';

describe('E2E_SEED', () => {
  it.each(LANES)('keeps asteroids out of the $name firing lane', (lane) => {
    expect(
      lanesStayClear(E2E_SEED, lane),
      `seed ${String(E2E_SEED)}'s asteroid layout now crosses the e2e firing lanes because spawning or RNG consumption changed; ${SCAN_HINT}, set E2E_SEED in game/e2e/seed.ts to the lowest lane-clear seed it prints, then rerun this test`,
    ).toBe(true);
  });
});

describe('GAME_OVER_SEED', () => {
  it.each(LANES)('ends a one-life idle run soon after the invulnerability ($name)', (lane) => {
    const seconds = idleDeathSeconds(GAME_OVER_SEED, lane);
    expect(
      seconds,
      `seed ${String(GAME_OVER_SEED)}'s idle ship no longer dies within ${String(MAX_DEATH_SECONDS)} s because spawning or RNG consumption changed; ${SCAN_HINT}, set GAME_OVER_SEED in game/e2e/seed.ts to the lowest game-over seed it prints, then rerun this test`,
    ).toBeLessThanOrEqual(MAX_DEATH_SECONDS);
  });
});

// Developer tool, not a check: E2E_SEED_SCAN=<from>-<to> prints replacement seeds in [from, to).
const scan = /^(\d+)-(\d+)$/.exec(process.env['E2E_SEED_SCAN'] ?? '');
it.runIf(scan)('scan: replacement e2e seeds', () => {
  const [from, to] = [Number(scan?.[1]), Number(scan?.[2])];
  const range = `[${String(from)}, ${String(to)})`;
  console.log(`seeds in ${range} that clear every lane: ${clearSeeds(from, to).join(', ') || 'none'}`);
  console.log(`seeds in ${range} whose idle ship dies in time: ${gameOverSeeds(from, to).join(', ') || 'none'}`);
});
