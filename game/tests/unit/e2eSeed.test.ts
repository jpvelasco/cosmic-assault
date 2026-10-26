import { describe, expect, it } from 'vitest';
import { BOSS_GALAXY, E2E_SEED, GAME_OVER_GALAXY, GAME_OVER_SEED, THREE_DEATHS_SECONDS, TO_BOSS_FIGHT_SECONDS } from '../../e2e/seed';
import { e2eSeeds, FIGHT_SLACK_SECONDS, gameOverSeedsWithThreeDeaths, idleDeathSeconds, LANES, lanesStayClear, MAX_DEATH_SECONDS, reachesBossFight, threeDeathSeconds } from '../helpers/e2eLanes';

const SCAN_HINT =
  'list replacements with "E2E_SEED_SCAN=0-300 npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose" (from game/; PowerShell: $env:E2E_SEED_SCAN=\'0-300\'; npx vitest run tests/unit/e2eSeed.test.ts --reporter=verbose)';

describe('E2E_SEED', () => {
  it.each(LANES)('keeps asteroids out of the $name firing lane', (lane) => {
    expect(
      lanesStayClear(E2E_SEED, lane),
      `seed ${String(E2E_SEED)}'s asteroid layout now crosses the e2e firing lanes because spawning or RNG consumption changed; ${SCAN_HINT}, set E2E_SEED in game/e2e/seed.ts to the lowest E2E_SEED candidate it prints, then rerun this test`,
    ).toBe(true);
  });

  it.each(LANES)(`keeps an idle ship alive through ${BOSS_GALAXY}'s approach and intro to the boss fight ($name field)`, (lane) => {
    expect(
      reachesBossFight(E2E_SEED, lane),
      `seed ${String(E2E_SEED)}'s idle ship no longer reaches the ${BOSS_GALAXY} boss fight alive (boss fighting at ${String(TO_BOSS_FIGHT_SECONDS)} s, ship alive ${String(FIGHT_SLACK_SECONDS)} s later), which progression.spec.ts relies on, because spawning, RNG consumption or the boss timings changed; ${SCAN_HINT}, set E2E_SEED in game/e2e/seed.ts to the lowest E2E_SEED candidate it prints, then rerun this test`,
    ).toBe(true);
  });
});

describe('GAME_OVER_SEED', () => {
  it.each(LANES)('ends a one-life idle run soon after the invulnerability ($name)', (lane) => {
    const seconds = idleDeathSeconds(GAME_OVER_SEED, lane);
    expect(
      seconds,
      `seed ${String(GAME_OVER_SEED)}'s idle ship no longer dies within ${String(MAX_DEATH_SECONDS)} s because spawning or RNG consumption changed; ${SCAN_HINT}, set GAME_OVER_SEED in game/e2e/seed.ts to the lowest GAME_OVER_SEED candidate it prints, then rerun this test`,
    ).toBeLessThanOrEqual(MAX_DEATH_SECONDS);
  });

  it(`loses all three lives of an idle Rank run in ${GAME_OVER_GALAXY} within THREE_DEATHS_SECONDS on the desktop field`, () => {
    expect(
      threeDeathSeconds(GAME_OVER_SEED),
      `seed ${String(GAME_OVER_SEED)}'s idle ship no longer loses three lives in ${GAME_OVER_GALAXY} within ${String(THREE_DEATHS_SECONDS)} s, which rank.spec.ts relies on to lose a continued run and to lose lives one at a time, because spawning or RNG consumption changed; ${SCAN_HINT}, set GAME_OVER_SEED in game/e2e/seed.ts to the lowest GAME_OVER_SEED candidate it prints, then rerun this test`,
    ).toBeLessThanOrEqual(THREE_DEATHS_SECONDS);
  });
});

// Developer tool, not a check: E2E_SEED_SCAN=<from>-<to> prints replacement seeds in [from, to).
const scan = /^(\d+)-(\d+)$/.exec(process.env['E2E_SEED_SCAN'] ?? '');
it.runIf(scan)('scan: replacement e2e seeds', () => {
  const [from, to] = [Number(scan?.[1]), Number(scan?.[2])];
  const range = `[${String(from)}, ${String(to)})`;
  console.log(`E2E_SEED candidates in ${range} (every lane clear, the boss fight reached): ${e2eSeeds(from, to).join(', ') || 'none'}`);
  console.log(`GAME_OVER_SEED candidates in ${range} (one life lost in time, and three): ${gameOverSeedsWithThreeDeaths(from, to).join(', ') || 'none'}`);
}, 600_000);
