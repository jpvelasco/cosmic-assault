import { describe, expect, it } from 'vitest';
import { E2E_SEEDS, seedFor } from '../../e2e/seeds';
import { CLAIMS, findSeeds, unmetClaimMessage } from '../helpers/seedClaims';
import { guardScript } from '../helpers/guardScript';

const { run: runFinder } = guardScript('find-seeds.mjs', 'find-seeds-');

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

describe('npm run find-seeds', () => {
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

  it('names the known claims when given an unknown one', () => {
    const { status, output } = runFinder('nope');
    expect(status).toBe(1);
    expect(output).toContain('unknown claim "nope"');
    expect(output).toContain('three-deaths');
  });
});
