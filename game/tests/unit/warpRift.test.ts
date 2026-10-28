import { describe, expect, it } from 'vitest';
import { FOES } from '../../src/content/foes';
import { WARP_RIFT } from '../../src/content/hazards';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { Bolt } from '../../src/sim/foes/bolts';
import type { HazardBolts } from '../../src/sim/hazards/hazard';

import { MOUTH_SPACING } from '../../src/sim/hazards/warpRift';
import { wrappedDistance } from '../../src/sim/wrap';
import type { GalaxyEvent } from '../../src/content/types';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { hazardStreams, HazardField } from '../../src/sim/hazards/hazardField';
import type { RiftState } from '../../src/sim/hazards/hazard';
import { createShip } from '../../src/sim/ship';
import { FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT } from '../../src/sim/config';
import { zoneKeepOutBoxes } from '../../src/sim/hazards/dangerZone';
import type { Asteroid } from '../../src/sim/asteroid';
import { foeAt } from '../helpers/foeAt';
import { JUMP_HEADINGS, JUMP_RADII, QUARTER_SECOND_STEPS, rockAt, strobeGaps } from '../helpers/riftStrobe';

const FIELD_43: Field = { width: FIELD_HEIGHT * MIN_ASPECT, height: FIELD_HEIGHT };
const FIELD_169: Field = { width: 1280, height: 720 };
const FIELD_219: Field = { width: FIELD_HEIGHT * MAX_ASPECT, height: FIELD_HEIGHT };
const R = WARP_RIFT.radius;
const DT = STEP_SECONDS;

interface Rig {
  readonly hazards: HazardField;
  readonly ship: ReturnType<typeof createShip>;
  readonly events: SimEvent[];
}

/** A hazard field with one warp rift event of `intensity` at `at`, its ship in the middle of the field and every stream from `seed`. */
function rig(opts: { seed?: number; field?: Field; intensity?: 1 | 2 | 3; at?: number; ship?: { x: number; y: number } } = {}): Rig {
  const { seed = 1, field = FIELD_169, intensity = 2, at = 20 } = opts;
  const events: GalaxyEvent[] = [{ at, type: 'warpRift', intensity }];
  const streams = hazardStreams(seed);
  let lastId = 0;
  const hazards = new HazardField(events, streams, () => ++lastId);
  const ship = createShip(opts.ship?.x ?? field.width / 2, opts.ship?.y ?? field.height / 2);
  ship.invulnerable = false;
  hazards.move(0, ship, [], [], []);
  return { hazards, ship, events: [] };
}

/** Steps the hazards to `seconds`, collecting every event pushed and the galaxy seconds it came at. */
function stepTo(r: Rig, field: Field, seconds: number, each?: (t: number) => void): { t: number; event: SimEvent }[] {
  const log: { t: number; event: SimEvent }[] = [];
  for (let t = DT; t <= seconds + 1e-9; t += DT) {
    const out: SimEvent[] = [];
    r.hazards.step(t, field, out);
    for (const event of out) log.push({ t, event });
    each?.(t);
  }
  return log;
}

const riftStates = (r: Rig): RiftState[] => r.hazards.states.filter((s): s is RiftState => s.type === 'warpRift');
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('warp rift placement', () => {
  it('shows min(intensity, 2) pairs as warnings and opens them for the rule, then closes them', () => {
    for (const [intensity, pairs] of [
      [1, 1],
      [2, 2],
      [3, 2],
    ] as const) {
      const r = rig({ intensity });
      const log = stepTo(r, FIELD_169, 40);
      expect(log.filter((l) => l.event.type === 'riftWarning'), `intensity ${String(intensity)}`).toHaveLength(pairs);
      const opened = log.filter((l) => l.event.type === 'riftOpen');
      expect(opened).toHaveLength(pairs);
      expect(log.filter((l) => l.event.type === 'riftClose')).toHaveLength(pairs);
      expect((opened[0]?.t ?? 0) - 20).toBeLessThan(DT * 2);
    }
  });

  it('places every pair inside the field, 60 from its edges and at least 0.4 of its width apart, at 4:3, 16:9 and 21:9', () => {
    for (const field of [FIELD_43, FIELD_169, FIELD_219]) {
      for (let seed = 1; seed <= 40; seed++) {
        const r = rig({ seed, field });
        const warnings = stepTo(r, field, 20).filter((l) => l.event.type === 'riftWarning').map((l) => l.event);
        // A crowded 4:3 field may drop a second pair (never a first); the wider fields always place both.
        expect(warnings.length, `${String(field.width)} seed ${String(seed)}`).toBeGreaterThanOrEqual(1);
        if (field.width > FIELD_43.width) expect(warnings, `${String(field.width)} seed ${String(seed)}`).toHaveLength(2);
        for (const w of warnings) {
          if (w.type !== 'riftWarning') continue;
          for (const [x, y] of [[w.x, w.y], [w.toX, w.toY]] as const) {
            expect(x).toBeGreaterThanOrEqual(WARP_RIFT.inset);
            expect(x).toBeLessThanOrEqual(field.width - WARP_RIFT.inset);
            expect(y).toBeGreaterThanOrEqual(WARP_RIFT.inset);
            expect(y).toBeLessThanOrEqual(field.height - WARP_RIFT.inset);
          }
          expect(dist({ x: w.x, y: w.y }, { x: w.toX, y: w.toY })).toBeGreaterThanOrEqual(WARP_RIFT.apart * field.width);
        }
      }
    }
  }, 30_000);

  it('keeps every mouth off the field centre, the ship, and the HUD and thumb corners, at 4:3, 16:9 and 21:9', () => {
    for (const field of [FIELD_43, FIELD_169, FIELD_219]) {
      for (let seed = 1; seed <= 40; seed++) {
        const ship = { x: field.width * 0.3, y: field.height * 0.7 };
        const r = rig({ seed, field, ship });
        const warnings = stepTo(r, field, 20).filter((l) => l.event.type === 'riftWarning').map((l) => l.event);
        const boxes = zoneKeepOutBoxes(field);
        const circles = [
          { x: field.width / 2, y: field.height / 2, r: ASTEROID.safeRadius },
          { x: ship.x, y: ship.y, r: ASTEROID.safeRadius },
        ];
        for (const w of warnings) {
          if (w.type !== 'riftWarning') continue;
          for (const [x, y] of [[w.x, w.y], [w.toX, w.toY]] as const) {
            for (const c of circles) expect(dist({ x, y }, c), `${String(field.width)} seed ${String(seed)}`).toBeGreaterThanOrEqual(c.r + R - 1e-9);
            for (const b of boxes) {
              const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0);
              const dy = Math.max(Math.abs(y - b.y) - b.h / 2, 0);
              // The drawn radius clears the corners wherever the field leaves room; only the 4:3 fallback may come down to the hitbox.
              const clear = field.width > FIELD_43.width ? WARP_RIFT.drawn : WARP_RIFT.radius;
              expect(Math.hypot(dx, dy), `box ${String(field.width)} seed ${String(seed)}`).toBeGreaterThanOrEqual(clear);
            }
          }
        }
      }
    }
  }, 30_000);
});

describe('warp rift passage', () => {
  it('does nothing while it warns: a ship in a mouth is not moved until the rift opens', () => {
    const r = rig({ seed: 2 });
    stepTo(r, FIELD_169, 19);
    const warned = r.hazards.states.find((s): s is RiftState => s.type === 'warpRift');
    expect(warned?.stage).toBe('warning');
    if (warned === undefined) return;
    r.ship.x = warned.x;
    r.ship.y = warned.y;
    r.hazards.move(DT, r.ship, [], [], []);
    expect(r.ship.x).toBe(warned.x);
    expect(r.ship.y).toBe(warned.y);
  });

  it('sends a ship that reaches an open mouth out of its paired one, along its velocity and just outside the mouth', () => {
    const r = rig({ seed: 3 });
    stepTo(r, FIELD_169, 22);
    const [pair] = riftStates(r);
    if (pair === undefined) throw new Error('a rift should be open');
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = 100;
    r.ship.vy = 0;
    const out: SimEvent[] = [];
    r.hazards.move(DT, r.ship, [], [], out);
    const exit = { x: pair.toX, y: pair.toY };
    expect(dist(r.ship, exit)).toBeGreaterThanOrEqual(R + PLAYER.radius);
    expect(dist(r.ship, exit)).toBeLessThanOrEqual(R + PLAYER.radius + 4);
    expect(r.ship.y).toBeCloseTo(exit.y, 9);
    expect(r.ship.x).toBeGreaterThan(exit.x);
    expect(r.ship.vx).toBe(100);
    expect(out).toEqual([{ type: 'riftJump', id: pair.id, x: pair.x, y: pair.y, toX: pair.toX, toY: pair.toY, ship: true }]);
  });

  it('resets a jumping ship\'s previous pose, so it does not streak across the field', () => {
    const r = rig({ seed: 4 });
    stepTo(r, FIELD_169, 22);
    const [pair] = riftStates(r);
    if (pair === undefined) throw new Error('a rift should be open');
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.px = pair.x;
    r.ship.py = pair.y;
    r.ship.vx = 0;
    r.ship.vy = 80;
    r.hazards.move(DT, r.ship, [], [], []);
    expect(r.ship.px).toBe(r.ship.x);
    expect(r.ship.py).toBe(r.ship.y);
  });

  it('sends a body with no velocity out the way away from its partner', () => {
    const r = rig({ seed: 5 });
    stepTo(r, FIELD_169, 22);
    const [pair] = riftStates(r);
    if (pair === undefined) throw new Error('a rift should be open');
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = r.ship.vy = 0;
    r.hazards.move(DT, r.ship, [], [], []);
    const awayAngle = Math.atan2(pair.toY - pair.y, pair.toX - pair.x);
    expect(Math.atan2(r.ship.y - pair.toY, r.ship.x - pair.toX)).toBeCloseTo(awayAngle, 6);
  });

  it('does not send a body back through the mouth it has just left, while it moves on', () => {
    const r = rig({ seed: 6 });
    stepTo(r, FIELD_169, 22);
    const [pair] = riftStates(r);
    if (pair === undefined) throw new Error('a rift should be open');
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = 150;
    r.ship.vy = 0;
    const out: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      r.hazards.move(DT, r.ship, [], [], out);
      r.ship.x += r.ship.vx * DT;
      r.ship.y += r.ship.vy * DT;
    }
    expect(out.filter((e) => e.type === 'riftJump')).toHaveLength(1);
  });

  it('sends a rock through too, and resets its previous pose', () => {
    const r = rig({ seed: 7 });
    stepTo(r, FIELD_169, 22);
    const [pair] = riftStates(r);
    if (pair === undefined) throw new Error('a rift should be open');
    const rock = { id: 500, x: pair.x, y: pair.y, px: pair.x - 30, py: pair.y, vx: 0, vy: -90, radius: ASTEROID.radii[1], size: 1 } as unknown as Asteroid;
    const out: SimEvent[] = [];
    r.hazards.move(DT, r.ship, [rock], [], out);
    expect(dist(rock, { x: pair.toX, y: pair.toY })).toBeGreaterThanOrEqual(R + rock.radius);
    expect(rock.px).toBe(rock.x);
    expect(rock.py).toBe(rock.y);
    expect(out).toContainEqual({ type: 'riftJump', id: pair.id, x: pair.x, y: pair.y, toX: pair.toX, toY: pair.toY, ship: false });
  });

  it('sends a foe through, and strikes nothing itself', () => {
    const r = rig({ seed: 8 });
    stepTo(r, FIELD_169, 22);
    const [pair] = riftStates(r);
    if (pair === undefined) throw new Error('a rift should be open');
    const drone = foeAt('drone', pair.x, pair.y, { id: 501 });
    r.hazards.move(DT, r.ship, [], [drone], []);
    expect(dist(drone, { x: pair.toX, y: pair.toY })).toBeGreaterThanOrEqual(R + FOES.drone.radius);
    expect(r.hazards.strikes(pair.x, pair.y, PLAYER.radius)).toBe(false);
  });

});

describe('warp rift chaining', () => {
  /** The least distance between a mouth of one pair and a mouth of the other: the spacing a configuration actually has. */
  function leastBetweenPairs(pairs: readonly RiftState[]): number {
    const [a, b] = pairs;
    if (a === undefined || b === undefined) throw new Error('two pairs');
    let least = Infinity;
    for (const m of [{ x: a.x, y: a.y }, { x: a.toX, y: a.toY }])
      for (const n of [{ x: b.x, y: b.y }, { x: b.toX, y: b.toY }]) least = Math.min(least, dist(m, n));
    return least;
  }

  it('places a second pair only at MOUTH_SPACING or not at all, at 4:3, 16:9 and 21:9', () => {
    expect(MOUTH_SPACING).toBe(2 * WARP_RIFT.radius + 2 * ASTEROID.radii[0] + 2);
    for (const field of [FIELD_43, FIELD_169, FIELD_219]) {
      for (let seed = 1; seed <= 30; seed++) {
        const r = rig({ seed, field, intensity: 2, ship: { x: 5, y: 5 } });
        stepTo(r, field, 22);
        const pairs = riftStates(r);
        const where = `${String(field.width)} seed ${String(seed)}`;
        if (pairs.length === 2) expect(leastBetweenPairs(pairs), where).toBeGreaterThanOrEqual(MOUTH_SPACING);
        if (field.width > FIELD_43.width) expect(pairs, where).toHaveLength(2);
      }
    }
  }, 30_000);

  it('carries a body out of every mouth, along every heading, for every body radius, once and never into another mouth, at 4:3, 16:9 and 21:9', () => {
    for (const field of [FIELD_43, FIELD_169, FIELD_219]) {
      for (let seed = 1; seed <= 12; seed++) {
        const r = rig({ seed, field, intensity: 2, ship: { x: 5, y: 5 } });
        stepTo(r, field, 22);
        const pairs = riftStates(r);
        if (pairs.length < 2) continue;
        const all = pairs.flatMap((pair) => [
          { x: pair.x, y: pair.y },
          { x: pair.toX, y: pair.toY },
        ]);
        const mouths = pairs.flatMap((pair) => [
          { x: pair.x, y: pair.y, to: { x: pair.toX, y: pair.toY } },
          { x: pair.toX, y: pair.toY, to: { x: pair.x, y: pair.y } },
        ]);
        for (const entry of mouths)
          for (const radius of JUMP_RADII)
            for (let h = 0; h < JUMP_HEADINGS; h++) {
              const rock = rockAt(entry, (h * 2 * Math.PI) / JUMP_HEADINGS, radius);
              const out: SimEvent[] = [];
              r.hazards.move(DT, r.ship, [rock], [], out);
              const where = `${String(field.width)} seed ${String(seed)} radius ${String(radius)} heading ${String(h)}`;
              expect(out.filter((e) => e.type === 'riftJump' && !e.ship), where).toHaveLength(1);
              for (const m of all) {
                if (m.x === entry.to.x && m.y === entry.to.y) continue;
                expect(wrappedDistance(rock, m, field), where).toBeGreaterThanOrEqual(WARP_RIFT.radius + radius);
              }
            }
      }
    }
  }, 30_000);

  it('never carries a body through a second pair more than once in any quarter second, over two seconds of motion, from every exit of every 4:3 configuration', () => {
    // The first seeds already strobe on the module this test guards against; the full sweep lives in the balance suite.
    for (let seed = 1; seed <= 4; seed++) for (const { where, gap } of strobeGaps(seed, FIELD_43)) expect(gap, where).toBeGreaterThanOrEqual(QUARTER_SECOND_STEPS);
  }, 30_000);
});

describe('warp rift exit grace', () => {
  /** A rift of one pair, open, and the ship set down at the mouth (at, heading `vx`), with `bodies` placed as given. */
  function openRift(seed: number) {
    const r = rig({ seed, intensity: 1 });
    stepTo(r, FIELD_169, 22);
    const [pair] = riftStates(r);
    if (pair === undefined) throw new Error('a rift should be open');
    return { r, pair };
  }

  it('grants the ship a grace of MIN_WINDUP_SECONDS when a jump puts it onto a rock', () => {
    const { r, pair } = openRift(21);
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = 100;
    r.ship.vy = 0;
    // The ship comes out of the other mouth 42 units east of it; a large rock lies 100 out, beyond its reach (90), so it
    // does not jump, yet it touches the ship there (60 + 10 against 58).
    const rock = { id: 701, x: pair.toX + 100, y: pair.toY, px: pair.toX + 100, py: pair.toY, vx: 0, vy: 0, radius: 60, size: 1 } as unknown as Asteroid;
    r.hazards.move(DT, r.ship, [rock], [], []);
    expect(r.ship.invulnerable).toBe(true);
    expect(r.ship.invulnerableFor).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
  });

  it('grants the same grace when a jump carries a rock onto a ship parked beside the other mouth', () => {
    const { r, pair } = openRift(22);
    // A rock at the first mouth, moving toward the second: it comes out of the second 72 units along that line.
    const dx = pair.toX - pair.x;
    const dy = pair.toY - pair.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    r.ship.x = pair.toX + ux * 80;
    r.ship.y = pair.toY + uy * 80;
    r.ship.vx = r.ship.vy = 0;
    const rock = { id: 702, x: pair.x, y: pair.y, px: pair.x, py: pair.y, vx: ux * 100, vy: uy * 100, radius: 40, size: 1 } as unknown as Asteroid;
    r.hazards.move(DT, r.ship, [rock], [], []);
    expect(r.ship.invulnerable).toBe(true);
    expect(r.ship.invulnerableFor).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
  });

  it('grants nothing when a jump lands clear of every body', () => {
    const { r, pair } = openRift(23);
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = 100;
    r.ship.vy = 0;
    r.hazards.move(DT, r.ship, [], [], []);
    expect(r.ship.invulnerable).toBe(false);
  });

  it('grants the same grace when a hostile bolt would reach the ship within a windup of its jump', () => {
    const { r, pair } = openRift(24);
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = 100;
    r.ship.vy = 0;
    // The exit is 42 east of the mouth; a bolt 60 further east flies back at the ship at 230 units a second.
    const bolt = { id: 801, x: pair.toX + 102, y: pair.toY, px: pair.toX + 102, py: pair.toY, vx: -230, vy: 0, radius: 5, age: 0, source: 'gunship', owner: 0, fromAttack: false } as unknown as Bolt;
    r.hazards.move(DT, r.ship, [], [], [], poolOf(bolt));
    expect(r.ship.invulnerable).toBe(true);
    expect(r.ship.invulnerableFor).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
  });

  it('grants the same grace when an armed mine\'s blast would reach the ship before its windup ends', () => {
    const { r, pair } = openRift(25);
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = 100;
    r.ship.vy = 0;
    // The mine lies 60 past the exit and blasts in 0.2 s; its reach (80) and the ship's radius (10) cover the gap.
    const mine = foeAt('mine', pair.toX + 102, pair.toY, { id: 802, timer: 0.2, charging: true });
    r.hazards.move(DT, r.ship, [], [mine], []);
    expect(r.ship.invulnerable).toBe(true);
    expect(r.ship.invulnerableFor).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
  });

  it('grants nothing for a mine whose blast falls after the windup, or for a bolt that flies away', () => {
    const { r, pair } = openRift(26);
    r.ship.x = pair.x;
    r.ship.y = pair.y;
    r.ship.vx = 100;
    r.ship.vy = 0;
    const late = foeAt('mine', pair.toX + 102, pair.toY, { id: 803, timer: 1, charging: true });
    const away = { id: 804, x: pair.toX + 102, y: pair.toY, px: pair.toX + 102, py: pair.toY, vx: 230, vy: 0, radius: 5, age: 0, source: 'gunship', owner: 0, fromAttack: false } as unknown as Bolt;
    r.hazards.move(DT, r.ship, [], [late], [], poolOf(away));
    expect(r.ship.invulnerable).toBe(false);
  });

  it('judges a charging mine carried out of a rift by its blast radius, so a ship its blast would reach is graced', () => {
    const { r, pair } = openRift(27);
    // A still mine at the first mouth leaves by the second, 44 out along the line between them; the ship waits 60 past it,
    // inside the mine's blast reach (80) and clear of its body, and is not itself carried.
    const dx = pair.toX - pair.x;
    const dy = pair.toY - pair.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    r.ship.x = pair.toX + ux * 104;
    r.ship.y = pair.toY + uy * 104;
    r.ship.vx = r.ship.vy = 0;
    const mine = foeAt('mine', pair.x, pair.y, { id: 805, timer: 0.2, charging: true });
    const out: SimEvent[] = [];
    r.hazards.move(DT, r.ship, [], [mine], out);
    expect(out.filter((e) => e.type === 'riftJump' && !e.ship)).toHaveLength(1);
    expect(r.ship.invulnerable).toBe(true);
    expect(r.ship.invulnerableFor).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
  });

  it('grants nothing for a carried mine whose blast falls outside the reach of the ship', () => {
    const { r, pair } = openRift(28);
    const dx = pair.toX - pair.x;
    const dy = pair.toY - pair.y;
    const length = Math.hypot(dx, dy);
    r.ship.x = pair.toX + (dx / length) * 200;
    r.ship.y = pair.toY + (dy / length) * 200;
    r.ship.vx = r.ship.vy = 0;
    const mine = foeAt('mine', pair.x, pair.y, { id: 806, timer: 0.2, charging: true });
    r.hazards.move(DT, r.ship, [], [mine], []);
    expect(r.ship.invulnerable).toBe(false);
  });
});

/** The galaxy's bolt pool, as a hazard sees it: its list, and the clearing a black hole asks of it. */
const poolOf = (...list: Bolt[]): HazardBolts => ({ list, clearWithin: () => undefined });
