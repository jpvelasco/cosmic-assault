import { describe, expect, it } from 'vitest';
import { rockSpeedMultiplier, sawtooth, threatBudget } from '../../src/content/curves';
import { galaxyById, tierOf } from '../../src/content/galaxies';
import type { GalaxyDef, ThreatKind } from '../../src/content/types';
import { FOES, SPLITTER_FRAGMENTS } from '../../src/content/foes';
import { fieldBudget, GalaxyDirector, SIZE_COST, THREAT_COST, type SpawnOrder } from '../../src/sim/galaxy/director';
import { pressureScale } from '../../src/sim/galaxy/pacing';
import { createRng } from '../../src/sim/rng';
import { MUTED_KINDS } from '../helpers/mute';

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
      cost += order.count * THREAT_COST[order.kind];
      const budget = fieldBudget(galaxy, elapsed, mercy, area);
      opts.onSpawn?.(cost, budget);
      peakShare = Math.max(peakShare, cost / budget);
    }
    cost *= 1 - (opts.decay ?? 0.1) * DT;
  }
  return { orders, times, peakShare, cost };
}

describe('THREAT_COST', () => {
  it('prices large 4, medium 2, small 1, splitter 3, drone 1, gunship 4, mine 2, phaser 2.5 and armoured 4, the foes from content', () => {
    expect(THREAT_COST).toEqual({ large: 4, medium: 2, small: 1, splitter: 3, drone: 1, gunship: 4, mine: 2, phaser: 2.5, armoured: 4 });
    for (const kind of ['splitter', 'drone', 'gunship', 'mine', 'phaser', 'armoured'] as const) expect(THREAT_COST[kind], kind).toBe(FOES[kind].cost);
  });

  it('prices a tiny fragment at half a small rock, so a splitter that breaks never adds cost', () => {
    expect(SIZE_COST[3] * SPLITTER_FRAGMENTS).toBeLessThanOrEqual(THREAT_COST.splitter);
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
    const g51 = galaxyById('5-1');
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const o of run(g51, seed, { start: 0, seconds: 14.9, decay: 1 }).orders) kinds.add(o.kind);
    }
    const late = (Object.keys(g51.kinds) as ThreatKind[]).filter((kind) => g51.kinds[kind].from !== 0);
    expect(late.length).toBeGreaterThan(0);
    for (const kind of late) expect(kinds.has(kind), kind).toBe(false);
    expect(kinds.size).toBeGreaterThan(0);
  });

  it('brings in every rock size once the opening is over', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const o of run(g53, seed, { start: 40, seconds: 20, decay: 1 }).orders) kinds.add(o.kind);
    }
    expect([...kinds].filter((k) => k === 'large' || k === 'medium' || k === 'small').sort()).toEqual(['large', 'medium', 'small']);
  });

  it('weights kinds by kindProbability: large rocks (0.6) outnumber small (0.1, from tier 0.5) at tier 0', () => {
    const counts: Record<ThreatKind, number> = { large: 0, medium: 0, small: 0, splitter: 0, drone: 0, gunship: 0, mine: 0, phaser: 0, armoured: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      for (const o of run(galaxyById('1-1'), seed, { start: 20, seconds: 30, decay: 2 }).orders) counts[o.kind]++;
    }
    expect(counts.large).toBeGreaterThan(counts.small);
  });

  it('spawns nothing when every kind has weight 0', () => {
    const mute: GalaxyDef = { ...g53, kinds: MUTED_KINDS };
    expect(run(mute, 1, { start: 40, seconds: 20 }).orders).toEqual([]);
  });

  it('speeds rocks up with the galaxy tier', () => {
    const early = run(galaxyById('1-1'), 1, { start: 20, seconds: 20, decay: 1 }).orders;
    const late = run(galaxyById('5-5'), 1, { start: 20, seconds: 20, decay: 1 }).orders;
    expect(early[0]?.speedMultiplier).toBeCloseTo(1, 10);
    expect(late[0]?.speedMultiplier).toBeCloseTo(rockSpeedMultiplier(tierOf(galaxyById('5-5'))), 10);
  });
});

describe('GalaxyDirector foes', () => {
  const g13 = galaxyById('1-3');
  const g21 = galaxyById('2-1');
  const kindsOf = (orders: readonly SpawnOrder[]): Set<string> => new Set(orders.map((o) => o.kind));

  it('brings in no splitter before 1-3 and no drone before Ion Reach', () => {
    for (const id of ['1-1', '1-2'] as const) {
      for (let seed = 1; seed <= 20; seed++) expect(kindsOf(run(galaxyById(id), seed, { start: 20, seconds: 40, decay: 1 }).orders).has('splitter')).toBe(false);
    }
    for (let seed = 1; seed <= 20; seed++) expect(kindsOf(run(galaxyById('1-5'), seed, { start: 20, seconds: 40, decay: 1 }).orders).has('drone')).toBe(false);
  });

  it('spawns splitters from 1-3 and drones in Ion Reach, once the opening is over', () => {
    const split = new Set<string>();
    const swarm = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const o of run(g13, seed, { start: 20, seconds: 30, decay: 1 }).orders) split.add(o.kind);
      for (const o of run(g21, seed, { start: 20, seconds: 30, decay: 1 }).orders) swarm.add(o.kind);
    }
    expect(split.has('splitter')).toBe(true);
    expect(split.has('drone')).toBe(false);
    expect([...swarm].sort()).toEqual(['drone', 'large', 'medium', 'small', 'splitter']);
  });

  it('holds foes back through the opening, as the new threats they are', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) for (const o of run(g21, seed, { start: 0, seconds: 14.9, decay: 1 }).orders) kinds.add(o.kind);
    expect(kinds.has('drone')).toBe(false);
    expect(kinds.has('splitter')).toBe(false);
  });

  it('orders rocks and splitters one at a time, and drones in groups of 3 to 5', () => {
    const counts = new Map<string, Set<number>>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const o of run(g21, seed, { start: 20, seconds: 40, decay: 1 }).orders) counts.set(o.kind, (counts.get(o.kind) ?? new Set()).add(o.count));
    }
    for (const kind of ['large', 'medium', 'small', 'splitter']) expect([...(counts.get(kind) ?? [])], kind).toEqual([1]);
    expect([...(counts.get('drone') ?? [])].sort()).toEqual([3, 4, 5]);
  });

  it('counts a whole group against the budget: a drone group is refused when its full cost does not fit', () => {
    const drones: GalaxyDef = { ...g21, kinds: { ...MUTED_KINDS, drone: { from: 0, base: 1, step: 0, max: 1 } } };
    const budget = fieldBudget(drones, 40, 1, AREA);
    // Room for two drones but not three.
    const tight = budget - 2 * FOES.drone.cost;
    const director = new GalaxyDirector(drones, createRng(1), AREA);
    for (let i = 0; i < 600; i++) expect(director.step(DT, { elapsed: 40 + i * DT, onFieldCost: tight, mercy: 1 })).toBeNull();
    const roomy = new GalaxyDirector(drones, createRng(1), AREA);
    const orders = Array.from({ length: 600 }, (_, i) => roomy.step(DT, { elapsed: 40 + i * DT, onFieldCost: 0, mercy: 1 })).filter((o) => o !== null);
    expect(orders.length).toBeGreaterThan(0);
  });

  it('keeps a mixed field of rocks and foes within budget across 10,000 steps, and presses against it', () => {
    let spawns = 0;
    const seen = new Set<string>();
    const result = run(g21, 11, {
      start: 20,
      seconds: 10_000 * DT,
      onSpawn: (cost, budget) => {
        spawns++;
        expect(cost).toBeLessThanOrEqual(budget + 1e-9);
      },
    });
    for (const o of result.orders) seen.add(o.kind);
    expect(spawns).toBeGreaterThan(20);
    expect(seen.has('drone') || seen.has('splitter')).toBe(true);
    expect(result.peakShare).toBeGreaterThan(0.8);
  });

  it('is deterministic with foes in the mix', () => {
    const a = run(g21, 5, { start: 0, seconds: 100 }).orders;
    expect(run(g21, 5, { start: 0, seconds: 100 }).orders).toEqual(a);
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

  it.each([
    ['dt', { dt: 0 }],
    ['dt', { dt: Number.NaN }],
    ['elapsed', { elapsed: -1 }],
    ['elapsed', { elapsed: Infinity }],
    ['onFieldCost', { onFieldCost: -1 }],
    ['onFieldCost', { onFieldCost: Number.NaN }],
    ['mercy', { mercy: 0 }],
    ['mercy', { mercy: 1.5 }],
    ['mercy', { mercy: Number.NaN }],
  ] as const)('rejects a bad %s in step() with a RangeError that says what to pass (%o)', (name, bad: { dt?: number; elapsed?: number; onFieldCost?: number; mercy?: number }) => {
    const director = new GalaxyDirector(g53, createRng(1), AREA);
    const { dt = DT, ...ctx } = { elapsed: 40, onFieldCost: 0, mercy: 1, ...bad };
    expect(() => director.step(dt, ctx)).toThrow(RangeError);
    expect(() => director.step(dt, ctx)).toThrow(new RegExp(`${name}.*(finite|between)`));
  });

  it('takes a new field area on resize, and refuses a bad one', () => {
    const director = new GalaxyDirector(g53, createRng(1), AREA);
    director.fieldArea = AREA * 2;
    expect(director.fieldArea).toBe(AREA * 2);
    expect(() => (director.fieldArea = -1)).toThrow(/fieldArea.*positive/);
  });
});
