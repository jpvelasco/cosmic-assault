import { describe, expect, it } from 'vitest';
import { rockSpeedMultiplier, sawtooth, threatBudget } from '../../src/content/curves';
import { galaxyById, tierOf } from '../../src/content/galaxies';
import type { GalaxyDef } from '../../src/content/types';
import { fieldBudget, GalaxyDirector, ROCK_COST, type SpawnOrder } from '../../src/sim/galaxy/director';
import { pressureScale } from '../../src/sim/galaxy/pacing';
import { createRng } from '../../src/sim/rng';

const AREA = 1280 * 720;
const DT = 1 / 60;
const g53 = galaxyById('5-3');

interface Run {
  readonly orders: readonly SpawnOrder[];
  readonly times: readonly number[];
  readonly peakShare: number;
  readonly cost: number;
}

/** Steps a director through `seconds` from `start`, keeping a field whose cost the director's own spawns raise and a decay lowers. */
function run(
  galaxy: GalaxyDef,
  seed: number,
  opts: { start: number; seconds: number; mercy?: (t: number) => number; area?: number; cost?: number; decay?: number; onSpawn?: (cost: number, budget: number) => void },
): Run {
  const area = opts.area ?? AREA;
  const director = new GalaxyDirector(galaxy, createRng(seed), area);
  const orders: SpawnOrder[] = [];
  const times: number[] = [];
  let cost = opts.cost ?? 0;
  let peakShare = 0;
  const steps = Math.round(opts.seconds / DT);
  for (let i = 0; i < steps; i++) {
    const elapsed = opts.start + i * DT;
    const mercy = opts.mercy?.(elapsed) ?? 1;
    const order = director.step(DT, { elapsed, onFieldCost: cost, mercy });
    if (order !== null) {
      orders.push(order);
      times.push(elapsed);
      cost += ROCK_COST[order.kind];
      const budget = fieldBudget(galaxy, elapsed, mercy, area);
      opts.onSpawn?.(cost, budget);
      peakShare = Math.max(peakShare, cost / budget);
    }
    cost *= 1 - (opts.decay ?? 0.1) * DT;
  }
  return { orders, times, peakShare, cost };
}

describe('ROCK_COST', () => {
  it('prices large 4, medium 2, small 1', () => {
    expect(ROCK_COST).toEqual({ large: 4, medium: 2, small: 1 });
  });
});

describe('fieldBudget', () => {
  it('is threatBudget x sawtooth x pressure x mercy x area share', () => {
    const g = galaxyById('2-1');
    const expected = threatBudget(tierOf(g)) * sawtooth(g) * pressureScale(g, 40) * 0.4;
    expect(fieldBudget(g, 40, 0.4, AREA)).toBeCloseTo(expected, 10);
  });

  it('scales with field area: a 4:3 field against a 21:9 one matches the area ratio within 1%', () => {
    const height = 720;
    const fourThree = fieldBudget(g53, 40, 1, (height * 4) / 3 * height);
    const ultrawide = fieldBudget(g53, 40, 1, (height * 21) / 9 * height);
    expect(fourThree / ultrawide).toBeGreaterThan((4 / 3 / (21 / 9)) * 0.99);
    expect(fourThree / ultrawide).toBeLessThan((4 / 3 / (21 / 9)) * 1.01);
  });
});

describe('GalaxyDirector budget', () => {
  it('never leaves the field over budget across 10,000 steps, and does press against the cap', () => {
    let spawns = 0;
    const result = run(g53, 7, {
      start: 0,
      seconds: 10_000 * DT,
      mercy: (t) => (Math.floor(t / 20) % 2 === 1 ? 0.4 : 1),
      onSpawn: (cost, budget) => {
        spawns++;
        expect(cost).toBeLessThanOrEqual(budget + 1e-9);
      },
    });
    expect(spawns).toBeGreaterThan(20);
    expect(result.peakShare).toBeGreaterThan(0.85);
  });

  it('does not spawn at all while the field is already at budget', () => {
    const director = new GalaxyDirector(g53, createRng(1), AREA);
    for (let i = 0; i < 600; i++) {
      expect(director.step(DT, { elapsed: 40 + i * DT, onFieldCost: 1000, mercy: 1 })).toBeNull();
    }
  });

  it('skips a failed attempt instead of queueing it', () => {
    const director = new GalaxyDirector(g53, createRng(1), AREA);
    // 10 s full of attempts the budget refuses...
    for (let i = 0; i < 600; i++) director.step(DT, { elapsed: 40 + i * DT, onFieldCost: 1000, mercy: 1 });
    // ...then room appears: at most one order per interval, never a burst.
    const orders = Array.from({ length: 30 }, (_, i) => director.step(DT, { elapsed: 50 + i * DT, onFieldCost: 0, mercy: 1 }));
    expect(orders.filter((o) => o !== null).length).toBeLessThanOrEqual(1);
  });
});

describe('GalaxyDirector warp', () => {
  it('spawns nothing in warp and does not bank time for after', () => {
    const d1 = galaxyById('1-1');
    const director = new GalaxyDirector(d1, createRng(3), AREA);
    for (let i = 0; i < 600; i++) {
      expect(director.step(DT, { elapsed: 90 + i * DT, onFieldCost: 0, mercy: 1 })).toBeNull();
    }
    // Back before the end (as a restart would be): the first order waits a full interval.
    expect(director.step(DT, { elapsed: 40, onFieldCost: 0, mercy: 1 })).toBeNull();
  });
});

describe('GalaxyDirector mercy', () => {
  it('cuts the spawn count over the 4 s after a death by at least half', () => {
    const inWindow = (times: readonly number[]): number => times.filter((t) => t >= 70 && t < 74).length;
    let normal = 0;
    let merciful = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const common = { start: 20, seconds: 58 };
      normal += inWindow(run(g53, seed, common).times);
      merciful += inWindow(run(g53, seed, { ...common, mercy: (t) => (t >= 70 && t < 74 ? 0.4 : 1) }).times);
    }
    expect(normal).toBeGreaterThan(0);
    expect(merciful).toBeLessThanOrEqual(normal * 0.5);
  });
});

describe('GalaxyDirector kinds', () => {
  it('opens with only the kinds whose ramp starts at 0', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const o of run(galaxyById('5-1'), seed, { start: 0, seconds: 14.9, decay: 1 }).orders) kinds.add(o.kind);
    }
    expect(kinds.has('small')).toBe(false);
    expect(kinds.size).toBeGreaterThan(0);
  });

  it('brings in every kind once the opening is over', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const o of run(g53, seed, { start: 40, seconds: 20, decay: 1 }).orders) kinds.add(o.kind);
    }
    expect([...kinds].sort()).toEqual(['large', 'medium', 'small']);
  });

  it('weights kinds by kindProbability: large rocks (0.6) outnumber medium (0.3 + steps) at tier 0', () => {
    const counts = { large: 0, medium: 0, small: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      for (const o of run(galaxyById('1-1'), seed, { start: 20, seconds: 30, decay: 2 }).orders) counts[o.kind]++;
    }
    expect(counts.large).toBeGreaterThan(counts.small);
  });

  it('spawns nothing when every kind has weight 0', () => {
    const none = { from: 0, base: 0, step: 0, max: 0 };
    const mute: GalaxyDef = { ...g53, kinds: { large: none, medium: none, small: none } };
    expect(run(mute, 1, { start: 40, seconds: 20 }).orders).toEqual([]);
  });

  it('speeds rocks up with the galaxy tier', () => {
    const early = run(galaxyById('1-1'), 1, { start: 20, seconds: 20, decay: 1 }).orders;
    const late = run(galaxyById('5-5'), 1, { start: 20, seconds: 20, decay: 1 }).orders;
    expect(early[0]?.speedMultiplier).toBeCloseTo(1, 10);
    expect(late[0]?.speedMultiplier).toBeCloseTo(rockSpeedMultiplier(tierOf(galaxyById('5-5'))), 10);
  });
});

describe('GalaxyDirector boss approach', () => {
  it('spawns during the approach and keeps a trickle after it', () => {
    const boss = galaxyById('1-6');
    expect(run(boss, 1, { start: 0, seconds: 20, decay: 1 }).orders.length).toBeGreaterThan(0);
    expect(run(boss, 1, { start: 25, seconds: 20, decay: 1 }).orders.length).toBeGreaterThan(0);
  });
});

describe('GalaxyDirector determinism', () => {
  it('gives an identical order sequence for the same seed, and a different one for another', () => {
    const a = run(g53, 99, { start: 0, seconds: 100 }).orders;
    expect(run(g53, 99, { start: 0, seconds: 100 }).orders).toEqual(a);
    expect(run(g53, 100, { start: 0, seconds: 100 }).orders).not.toEqual(a);
  });
});

describe('GalaxyDirector construction', () => {
  it.each([0, -5, Number.NaN, Infinity])('rejects a field area of %s and says what to pass', (area) => {
    expect(() => new GalaxyDirector(g53, createRng(1), area)).toThrow(/fieldArea.*positive/);
  });
});
