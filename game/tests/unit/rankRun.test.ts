import { describe, expect, it } from 'vitest';
import { galaxyById, GALAXIES } from '../../src/content/galaxies';
import type { GalaxyId } from '../../src/content/types';
import { afterClear, afterForfeit, afterGameOver, afterHit, afterLoss, compareRuns, startRank, type RankRun } from '../../src/meta/rankRun';

const TODAY = '2026-10-26';

describe('startRank', () => {
  it('starts at 1-1 with no score, 3 lives, base weapon and no Continue used', () => {
    expect(startRank(TODAY)).toEqual({ next: '1-1', score: 0, lives: 3, weaponTier: 0, continued: false, startedAt: TODAY, inGalaxy: false });
  });
});

describe('afterClear', () => {
  const at = (next: GalaxyId, overrides: Partial<RankRun> = {}): RankRun => ({ ...startRank(TODAY), next, ...overrides });

  it('advances to the next galaxy and carries score and lives', () => {
    expect(afterClear(at('1-1'), galaxyById('1-1'), 1200, 2, 0)).toEqual({ ...at('1-2'), score: 1200, lives: 2 });
  });

  it('carries the weapon tier the galaxy ended on, up or down, and keeps the Continue mark and the start date', () => {
    const run = at('2-3', { weaponTier: 2, continued: true });
    expect(afterClear(run, galaxyById('2-3'), 50, 3, 2)).toMatchObject({ weaponTier: 2, continued: true, startedAt: TODAY });
    expect(afterClear(run, galaxyById('2-3'), 50, 3, 3)).toMatchObject({ weaponTier: 3 });
    expect(afterClear(run, galaxyById('2-3'), 50, 3, 0)).toMatchObject({ weaponTier: 0 });
  });

  it('does not mutate the run it is given', () => {
    const run = at('1-1');
    afterClear(run, galaxyById('1-1'), 10, 1, 0);
    expect(run).toEqual(at('1-1'));
  });

  it('a boss clear gives one life and opens the next Dimension', () => {
    expect(afterClear(at('1-6'), galaxyById('1-6'), 9000, 2, 0)).toMatchObject({ next: '2-1', lives: 3, score: 9000 });
  });

  it('a survival clear never gives a life', () => {
    expect(afterClear(at('3-5'), galaxyById('3-5'), 9000, 3, 0)).toMatchObject({ lives: 3 });
  });

  it('caps lives at 5', () => {
    expect(afterClear(at('2-6'), galaxyById('2-6'), 1, 4, 0)).toMatchObject({ lives: 5 });
    expect(afterClear(at('3-6'), galaxyById('3-6'), 1, 5, 0)).toMatchObject({ lives: 5 });
  });

  it('refuses to clear a galaxy other than the run next, saying which was expected', () => {
    expect(() => afterClear(at('2-3'), galaxyById('2-4'), 1, 3, 0)).toThrow(RangeError);
    expect(() => afterClear(at('2-3'), galaxyById('2-4'), 1, 3, 0)).toThrow(/2-4.*2-3/);
  });

  it('is complete after 5-★, not after earlier galaxies', () => {
    expect(afterClear(at('5-6'), galaxyById('5-6'), 99999, 3, 0)).toBe('complete');
    expect(afterClear(at('5-5'), galaxyById('5-5'), 1, 3, 0)).not.toBe('complete');
  });

  it('plays through all 30 galaxies in order and then completes', () => {
    let run: RankRun | 'complete' = startRank(TODAY);
    let cleared = 0;
    for (const g of GALAXIES) {
      if (run === 'complete') throw new Error(`complete too early, before ${g.id}`);
      expect(run.next).toBe(g.id);
      run = afterClear(run, g, cleared, run.lives, 0);
      cleared++;
    }
    expect(run).toBe('complete');
    expect(cleared).toBe(30);
  });
});

describe('afterGameOver (Continue)', () => {
  it('keeps the galaxy, restores 3 lives, zeroes the score and marks the run continued', () => {
    const run: RankRun = { next: '3-4', score: 4200, lives: 0, weaponTier: 2, continued: false, startedAt: TODAY, inGalaxy: false };
    expect(afterGameOver(run)).toEqual({ next: '3-4', score: 0, lives: 3, weaponTier: 2, continued: true, startedAt: TODAY, inGalaxy: false });
    expect(run.score).toBe(4200);
  });

  it('a second Continue stays continued', () => {
    expect(afterGameOver({ ...startRank(TODAY), continued: true }).continued).toBe(true);
  });
});

describe('compareRuns', () => {
  const base: RankRun = { next: '2-3', score: 1500, lives: 3, weaponTier: 1, continued: false, startedAt: TODAY, inGalaxy: false };
  /** `better` beats `worse` whichever is passed first. */
  const expectAhead = (better: RankRun, worse: RankRun): void => {
    expect(compareRuns(worse, better)).toBeGreaterThan(0);
    expect(compareRuns(better, worse)).toBeLessThan(0);
  };

  it('ties only on identical runs', () => {
    expect(compareRuns(base, { ...base })).toBe(0);
  });

  it('decides on the weapon tier once galaxy, score, Continue and lives tie', () => {
    expectAhead({ ...base, weaponTier: 2 }, base);
  });

  it('decides on the start date, earlier first, once everything else ties', () => {
    expectAhead(base, { ...base, startedAt: '2026-10-27' });
  });

  it('lets a higher level win over every lower one', () => {
    // More lives beat a better weapon and an earlier start; a better weapon beats an earlier start.
    expectAhead({ ...base, lives: 4, weaponTier: 0, startedAt: '2026-12-31' }, { ...base, startedAt: '2026-01-01', weaponTier: 3 });
    expectAhead({ ...base, weaponTier: 2, startedAt: '2026-12-31' }, { ...base, startedAt: '2026-01-01' });
  });
});

describe('afterClear between galaxies', () => {
  it('saves the run as between galaxies, whatever it was while playing', () => {
    const playing = { ...startRank(TODAY), inGalaxy: true };
    expect(afterClear(playing, galaxyById('1-1'), 500, 3, 0)).toMatchObject({ next: '1-2', inGalaxy: false });
  });
});

describe('afterForfeit (a Rank galaxy left unfinished)', () => {
  const playing: RankRun = { next: '2-4', score: 3100, lives: 3, weaponTier: 1, continued: false, startedAt: TODAY, inGalaxy: true };

  it('costs one life and keeps the score the run had before the galaxy, back between galaxies', () => {
    expect(afterForfeit(playing, 3, 1)).toEqual({ ...playing, lives: 2, weaponTier: 0, inGalaxy: false });
    expect(playing.lives).toBe(3);
  });

  it('counts as a death for the weapon: one tier lost from what the galaxy left, never below 0', () => {
    const armed = { ...playing, weaponTier: 3 as const };
    expect(afterForfeit(armed, 3, 3).weaponTier).toBe(2);
    expect(afterForfeit(armed, 3, 2).weaponTier).toBe(1);
    expect(afterForfeit(armed, 3, 0).weaponTier).toBe(0);
  });

  it('never refunds a tier: pickups taken in the abandoned galaxy are not kept', () => {
    expect(afterForfeit({ ...playing, weaponTier: 1 }, 3, 3).weaponTier).toBe(0);
    expect(afterForfeit({ ...playing, weaponTier: 2 }, 3, 3).weaponTier).toBe(1);
  });

  it('counts from the lives the ship has now, so the lives lost in the galaxy stay lost', () => {
    expect(afterForfeit(playing, 1, 0)).toMatchObject({ lives: 0, inGalaxy: false });
    expect(afterForfeit({ ...playing, lives: 5 }, 3, 0)).toMatchObject({ lives: 2 });
  });

  it('never refunds a life: more lives left than the run carried count as the run\'s own', () => {
    expect(afterForfeit(playing, 5, 0)).toMatchObject({ lives: 2 });
  });

  it('leaves a last-life run with no lives, which only a Continue can take on', () => {
    expect(afterForfeit({ ...playing, lives: 1 }, 1, 0)).toMatchObject({ lives: 0, score: 3100, next: '2-4', inGalaxy: false });
  });

  it('never goes below no lives', () => {
    expect(afterForfeit({ ...playing, lives: 0 }, 0, 0).lives).toBe(0);
  });
});

describe('afterHit (the ship hit mid-galaxy)', () => {
  const playing: RankRun = { ...startRank(TODAY), next: '1-3', score: 900, lives: 4, inGalaxy: true };

  it('keeps the run in its galaxy on the lives left, so a later forfeit counts from them', () => {
    expect(afterHit(playing, 3, 0)).toEqual({ ...playing, lives: 3 });
    expect(afterForfeit(afterHit(afterHit(playing, 3, 0), 2, 0), 2, 0)).toMatchObject({ lives: 1, score: 900 });
  });

  it('saves the tier the death left, so a forfeit cannot undo it, and never a gain', () => {
    const armed = { ...playing, weaponTier: 2 as const };
    expect(afterHit(armed, 3, 1).weaponTier).toBe(1);
    expect(afterHit(armed, 3, 3).weaponTier).toBe(2);
  });

  it('never adds lives', () => {
    expect(afterHit(playing, 5, 0).lives).toBe(4);
  });
});

describe('afterLoss (the last life gone)', () => {
  const playing: RankRun = { next: '3-1', score: 5000, lives: 1, weaponTier: 2, continued: false, startedAt: TODAY, inGalaxy: true };

  it('leaves the run with no lives, between galaxies, at the tier the death left', () => {
    expect(afterLoss(playing, 1)).toEqual({ ...playing, lives: 0, weaponTier: 1, inGalaxy: false });
    expect(afterLoss(playing, 3).weaponTier).toBe(2);
  });

  it('keeps that tier through a Continue', () => {
    expect(afterGameOver(afterLoss(playing, 1))).toMatchObject({ lives: 3, weaponTier: 1, continued: true });
  });
});
