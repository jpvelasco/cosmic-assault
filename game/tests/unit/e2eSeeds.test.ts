import { describe, expect, it } from 'vitest';
import { dateFor, E2E_DATES, E2E_SEEDS, seedFor } from '../../e2e/seeds';
import { CLAIMS, DATE_CLAIMS, findDates, findSeeds, unmetClaimMessage, unmetDateClaimMessage } from '../helpers/seedClaims';
import { guardScript } from '../helpers/guardScript';

const { run: runFinder } = guardScript('find-seeds.mjs', 'find-seeds-');

/** The finder loads the whole sim through Vite before it plays a seed: over 40 s on a loaded host. */
const FINDER_TIMEOUT_MS = 120_000;

describe('the e2e seed table', () => {
  it.each(E2E_SEEDS)('keeps seed $seed for the "$claim" claim in $galaxy', (entry) => {
    expect(CLAIMS[entry.claim].holds(entry.seed, entry.galaxy), unmetClaimMessage(entry)).toBe(true);
  });

  it('names every claim once, and has a check for each', () => {
    const claims = E2E_SEEDS.map((entry) => entry.claim);
    expect(new Set(claims).size).toBe(claims.length);
    expect(Object.keys(CLAIMS).sort()).toEqual([...claims].sort());
  });

  it('looks a claim up by name', () => {
    expect(seedFor('boss-fight')).toBe(E2E_SEEDS.find((entry) => entry.claim === 'boss-fight')?.seed);
  });
});

describe('the e2e date table', () => {
  it.each(E2E_DATES)('keeps $date for the "$claim" claim', (entry) => {
    expect(DATE_CLAIMS[entry.claim].holds(entry.date), unmetDateClaimMessage(entry)).toBe(true);
  });

  it('names every date claim once, and has a check for each', () => {
    const claims = E2E_DATES.map((entry) => entry.claim);
    expect(new Set(claims).size).toBe(claims.length);
    expect(Object.keys(DATE_CLAIMS).sort()).toEqual([...claims].sort());
  });

  it('says which date broke and the command that re-picks it', () => {
    const message = unmetDateClaimMessage({ date: '2026-03-04', claim: 'daily-clears' });
    expect(message).toContain('2026-03-04');
    expect(message).toContain('run: npm run find-seeds -- daily-clears');
    expect(message).toContain('game/e2e/seeds.ts');
  });

  it('finds the earliest dates that keep a claim, from a day after the epoch on', () => {
    const found = findDates('daily-game-over', { count: 2 });
    expect(found).toHaveLength(2);
    expect(found[0]).toBe(dateFor('daily-game-over'));
    for (const date of found) expect(DATE_CLAIMS['daily-game-over'].holds(date)).toBe(true);
    expect(findDates('daily-game-over', { from: 30, count: 1 })[0]?.localeCompare('2026-01-31')).toBeGreaterThanOrEqual(0);
  });
});

describe('unmetClaimMessage', () => {
  it('says which claim broke, in which galaxy, and the command that re-picks the seed', () => {
    const message = unmetClaimMessage({ seed: 9, claim: 'three-deaths', galaxy: '5-5' });
    expect(message).toContain('seed 9');
    expect(message).toContain('5-5');
    expect(message).toContain('run: npm run find-seeds -- three-deaths');
    expect(message).toContain('game/e2e/seeds.ts');
  });
});

describe('findSeeds', () => {
  it('lists the lowest seeds from a start that keep a claim, in order', () => {
    const found = findSeeds('lanes-clear', { from: 1, count: 3 });
    expect(found).toHaveLength(3);
    expect(found).toEqual([...found].sort((a, b) => a - b));
    for (const seed of found) expect(CLAIMS['lanes-clear'].holds(seed, '1-1')).toBe(true);
  });

  it('starts at `from`', () => {
    expect(findSeeds('lanes-clear', { from: 40, count: 1 })[0]).toBeGreaterThanOrEqual(40);
  });

  it('gives up at `to` rather than scanning for ever', () => {
    expect(findSeeds('boss-fight', { from: 1, count: 5, to: 2 }).length).toBeLessThanOrEqual(1);
  });
});

describe('npm run find-seeds', { timeout: FINDER_TIMEOUT_MS }, () => {
  it('prints the seeds that keep a claim', () => {
    const { status, output } = runFinder('lanes-clear', '--count', '2');
    expect(status).toBe(0);
    expect(output).toMatch(/^lanes-clear: \d+, \d+\n$/);
  });

  it('lists the claims when none is named', () => {
    const { status, output } = runFinder();
    expect(status).toBe(1);
    expect(output).toContain('boss-fight');
    expect(output).toContain('usage: npm run find-seeds -- <claim>');
  });

  it('refuses a count of 0 and an option it does not know, saying what to use', () => {
    const none = runFinder('lanes-clear', '--count', '0');
    expect(none.status).toBe(1);
    expect(none.output).toContain('--count needs a whole number of 1 or more');
    const typo = runFinder('lanes-clear', '--cnt', '2');
    expect(typo.status).toBe(1);
    expect(typo.output).toContain('unknown option "--cnt"; the options are --count, --from, --to');
  });

  it('names the known claims when given an unknown one', () => {
    const { status, output } = runFinder('nope');
    expect(status).toBe(1);
    expect(output).toContain('unknown claim "nope"');
    expect(output).toContain('three-deaths');
  });
});
