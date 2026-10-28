import { describe, expect, it } from 'vitest';
import { eventSeconds, eventsOfType } from '../../src/content/curves';
import { GALAXIES, galaxyById } from '../../src/content/galaxies';
import { HAZARD_RULES, WELL_MAX_ACCEL, WELL_MIN_RADIUS, WELL_SPEED_CAP, WELL_STRENGTH } from '../../src/content/hazards';
import { lullStart, LULL_SECONDS } from '../../src/content/pacingRules';
import type { FoeKind, GalaxyDef, GalaxyEvent } from '../../src/content/types';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { FoePool, type Foe } from '../../src/sim/foes/foe';
import { ForceField, wellAcceleration } from '../../src/sim/hazards/forceField';
import type { HazardState, Pullable } from '../../src/sim/hazards/hazard';
import { shipPullAt, type ShipPull } from '../../src/sim/hazards/shipPull';
import { createRng } from '../../src/sim/rng';
import { rescale } from '../../src/sim/wrap';
import { World } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';

const FIELD: Field = { width: 1280, height: 720 };
const DT = STEP_SECONDS;
const WELL_AT = 20;

const well = (at: number, intensity: GalaxyEvent['intensity'] = 2): GalaxyEvent => ({ at, type: 'gravityWell', intensity });
const body = (x: number, y: number, vx = 0, vy = 0): Pullable => ({ x, y, vx, vy });

function foeAt(pool: FoePool, kind: FoeKind, x: number, y: number): Foe {
  const foe = pool.acquire(kind, 1);
  if (foe === null) throw new Error('the pool should have room');
  return Object.assign(foe, { x, y });
}

const WELL_TELEGRAPH_SECONDS = HAZARD_RULES.gravityWell.telegraph;
const WELL_SECONDS = HAZARD_RULES.gravityWell.seconds;

function forceField(events: readonly GalaxyEvent[], seed = 1, kind: 'gravityWell' | 'repulsionField' = 'gravityWell'): ForceField {
  let last = 0;
  return new ForceField(kind, kind === 'gravityWell' ? 1 : -1, { events: eventsOfType(events, kind), rng: createRng(seed), nextId: () => ++last, keepOuts: () => [], inPlay: () => [] });
}

const stateOf = (w: ForceField): HazardState | null => w.states[0] ?? null;

/** Pulls `rocks` and `foes` one step, and returns the field's pull on a ship at `ship`, as the hazard field applies it. */
function pull(w: ForceField, dt: number, rocks: readonly Pullable[], foes: readonly Foe[] = [], ship: Pullable = body(-1e6, -1e6)): ShipPull {
  w.pull(dt, { rocks, foes });
  return shipPullAt(w.states, ship.x, ship.y, dt, { x: 0, y: 0 });
}

interface Beat {
  readonly event: SimEvent;
  readonly elapsed: number;
}

/** Steps a schedule through `seconds` at the fixed step, logging each event with the elapsed time of its step. */
function trace(w: ForceField, seconds: number): Beat[] {
  const out: SimEvent[] = [];
  const log: Beat[] = [];
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    out.length = 0;
    w.step(i * DT, FIELD, out);
    for (const event of out) log.push({ event: { ...event }, elapsed: i * DT });
  }
  return log;
}

describe('wellAcceleration', () => {
  it('is k / max(r, 60)^2, k being 800,000 times the intensity', () => {
    expect(WELL_STRENGTH).toBe(800_000);
    expect(wellAcceleration(300, 1)).toBeCloseTo(800_000 / 300 ** 2, 10);
    expect(wellAcceleration(200, 2)).toBeCloseTo(40, 10);
    expect(wellAcceleration(400, 3)).toBeCloseTo(15, 10);
  });

  it('falls with the square of the distance while under the cap', () => {
    expect(wellAcceleration(400, 1) / wellAcceleration(200, 1)).toBeCloseTo(0.25, 10);
  });

  it('never passes 140 units/s^2, at any distance or intensity', () => {
    expect(WELL_MAX_ACCEL).toBe(140);
    for (const intensity of [1, 2, 3]) {
      for (let r = 0; r <= 3000; r += 0.5) expect(wellAcceleration(r, intensity)).toBeLessThanOrEqual(WELL_MAX_ACCEL);
    }
    expect(wellAcceleration(60, 3)).toBe(140);
    expect(wellAcceleration(0, 3)).toBe(140);
  });

  it('floors the distance at 60: a body at the centre pulls no harder than one at 60, and the pull stays finite', () => {
    expect(WELL_MIN_RADIUS).toBe(60);
    for (const r of [0, 1, 30, 59.9, 60]) expect(wellAcceleration(r, 1)).toBe(wellAcceleration(60, 1));
    expect(Number.isFinite(wellAcceleration(0, 3))).toBe(true);
    expect(wellAcceleration(61, 1)).toBeLessThanOrEqual(wellAcceleration(60, 1));
  });

  it('holds the cap out to sqrt(k / 140) from the centre: about 76, 107 and 131 units at intensity 1, 2 and 3', () => {
    for (const [intensity, reach] of [[1, 75.6], [2, 106.9], [3, 130.9]] as const) {
      expect(wellAcceleration(reach - 1, intensity), String(intensity)).toBe(140);
      expect(wellAcceleration(reach + 1, intensity), String(intensity)).toBeLessThan(140);
    }
  });
});

describe('ForceField schedule', () => {
  it('draws a well 2 s ahead, then starts it on time and ends it 14 s later, with matching ids', () => {
    const w = forceField([well(WELL_AT)]);
    const log = trace(w, 40);
    expect(log.map((b) => b.event.type)).toEqual(['wellWarning', 'wellStart', 'wellEnd']);
    const [warning, start, end] = log;
    expect(warning?.elapsed).toBeCloseTo(WELL_AT - WELL_TELEGRAPH_SECONDS, 1);
    expect(warning?.event).toMatchObject({ type: 'wellWarning', id: 1, kind: 'gravityWell', at: WELL_AT });
    expect(start?.elapsed).toBeCloseTo(WELL_AT, 1);
    expect(end?.elapsed).toBeCloseTo(WELL_AT + WELL_SECONDS, 1);
    expect(WELL_TELEGRAPH_SECONDS).toBe(2);
    expect(WELL_SECONDS).toBe(14);
    expect(start?.event).toEqual({ type: 'wellStart', id: 1, kind: 'gravityWell' });
    expect(end?.event).toEqual({ type: 'wellEnd', id: 1, kind: 'gravityWell' });
  });

  it('does not pull during its warning, and draws it where it will be', () => {
    const w = forceField([well(WELL_AT)]);
    const log = trace(w, WELL_AT - 1);
    expect(stateOf(w)).toMatchObject({ stage: 'warning' });
    const warning = log[0]?.event;
    expect(warning).toMatchObject({ type: 'wellWarning' });
    if (warning?.type !== 'wellWarning') return;
    expect(stateOf(w)).toMatchObject({ x: warning.x, y: warning.y });
    const rock = body(warning.x + 100, warning.y);
    expect(pull(w, DT, [rock], [], body(warning.x - 100, warning.y))).toEqual({ x: 0, y: 0 });
    expect(rock.vx).toBe(0);
    expect(stateOf(w)?.remaining).toBeCloseTo(1, 1);
  });

  it('places the well inside the field, clear of its edges, from the hazards stream alone', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const log = trace(forceField([well(WELL_AT)], seed), 19);
      const warning = log[0]?.event;
      if (warning?.type !== 'wellWarning') throw new Error('expected a warning');
      expect(warning.x).toBeGreaterThanOrEqual(FIELD.width * 0.25);
      expect(warning.x).toBeLessThanOrEqual(FIELD.width * 0.75);
      expect(warning.y).toBeGreaterThanOrEqual(FIELD.height * 0.25);
      expect(warning.y).toBeLessThanOrEqual(FIELD.height * 0.75);
    }
    const place = (seed: number): SimEvent | undefined => trace(forceField([well(WELL_AT)], seed), 19)[0]?.event;
    expect(place(4)).toEqual(place(4));
    expect(place(4)).not.toEqual(place(5));
  });

  it('runs a galaxy\'s wells in turn and ignores its showers', () => {
    const events: GalaxyEvent[] = [{ at: 10, type: 'meteorShower', intensity: 1 }, well(25), well(45)];
    const log = trace(forceField(events), 70);
    expect(log.map((b) => b.event.type)).toEqual(['wellWarning', 'wellStart', 'wellEnd', 'wellWarning', 'wellStart', 'wellEnd']);
  });

  it('stops at once and silently when the galaxy ends', () => {
    const w = forceField([well(WELL_AT), well(60)]);
    trace(w, WELL_AT + 3);
    expect(stateOf(w)).toMatchObject({ stage: 'active' });
    w.stop();
    expect(stateOf(w)).toBeNull();
    const out: SimEvent[] = [];
    w.step(60, FIELD, out);
    expect(out).toEqual([]);
    const rock = body(10, 10);
    expect(pull(w, DT, [rock], [], body(20, 20))).toEqual({ x: 0, y: 0 });
    expect(rock.vx).toBe(0);
  });

  it('never lets a well fall in the lull: every well of every galaxy has ended by the time the lull starts', () => {
    let checked = 0;
    for (const g of GALAXIES) {
      const log = trace(forceField(g.events), g.duration);
      for (const { event, elapsed } of log) {
        if (event.type !== 'wellStart' && event.type !== 'wellEnd') continue;
        checked++;
        const inLull = elapsed > lullStart(g) + 0.05 && elapsed < lullStart(g) + LULL_SECONDS;
        expect(inLull, `${g.id} ${event.type} at ${elapsed.toFixed(2)}`).toBe(false);
      }
      for (const e of g.events) if (e.type === 'gravityWell') expect(e.at + eventSeconds(e)).toBeLessThanOrEqual(lullStart(g));
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('ForceField pull', () => {
  function active(intensity: GalaxyEvent['intensity'] = 2) {
    const w = forceField([well(WELL_AT, intensity)]);
    const log = trace(w, WELL_AT + 0.5);
    const warning = log[0]?.event;
    if (warning?.type !== 'wellWarning') throw new Error('expected a warning');
    return { w, x: warning.x, y: warning.y };
  }

  it('nudges a still body toward the well by exactly a x dt', () => {
    const { w, x, y } = active(1);
    const rock = body(x + 200, y);
    pull(w, DT, [rock]);
    expect(rock.vx).toBeCloseTo(-wellAcceleration(200, 1) * DT, 12);
    expect(rock.vy).toBeCloseTo(0, 12);
    const below = body(x, y - 100);
    pull(w, DT, [below]);
    expect(below.vy).toBeCloseTo(wellAcceleration(100, 1) * DT, 12);
  });

  it('caps the nudge at 140 units/s^2 even in a strong well, right on top of it', () => {
    const { w, x, y } = active(3);
    const close = body(x + 5, y + 5);
    pull(w, 1, [close]);
    expect(Math.hypot(close.vx, close.vy)).toBeLessThanOrEqual(WELL_MAX_ACCEL + 1e-9);
    expect(Math.hypot(close.vx, close.vy)).toBeCloseTo(140, 9);
  });

  it('pulls every rock and a splitter, but not a drone, and adds the ship\'s pull to the accumulator without moving it', () => {
    const { w, x, y } = active(1);
    const ship = body(x + 150, y);
    const rocks = [body(x, y + 150), body(x - 150, y)];
    const pool = new FoePool(2);
    const splitter = foeAt(pool, 'splitter', x, y - 150);
    const drone = foeAt(pool, 'drone', x + 150, y + 150);
    const shipPull = pull(w, DT, rocks, [splitter, drone], ship);
    expect(shipPull.x).toBeCloseTo(-wellAcceleration(150, 1) * DT, 12);
    expect(shipPull.y).toBeCloseTo(0, 12);
    expect(ship).toMatchObject({ vx: 0, vy: 0 });
    expect(rocks[0]?.vy).toBeLessThan(0);
    expect(rocks[1]?.vx).toBeGreaterThan(0);
    expect(splitter.vy).toBeGreaterThan(0);
    expect(drone).toMatchObject({ vx: 0, vy: 0 });
  });

  it('lets a pull speed a body up to 300 and no further, but never slows a body that is already faster', () => {
    const { w, x, y } = active(3);
    const rock = body(x + 100, y, -299.9, 0);
    for (let i = 0; i < 100; i++) pull(w, DT, [rock]);
    expect(Math.hypot(rock.vx, rock.vy)).toBeLessThanOrEqual(WELL_SPEED_CAP + 1e-9);
    const fast = body(x + 100, y, -340, 0);
    pull(w, DT, [fast]);
    expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(340, 9);
  });

  it('skips a body exactly at the centre rather than dividing by zero', () => {
    const { w, x, y } = active(2);
    const rock = body(x, y, 3, 4);
    expect(pull(w, DT, [rock], [], body(x, y))).toEqual({ x: 0, y: 0 });
    expect(rock).toMatchObject({ vx: 3, vy: 4 });
  });
});

describe('a well in a World', () => {
  /** A Free-play D2 galaxy that spawns nothing, with one well at 20 s. */
  const calm: GalaxyDef = { ...galaxyById('2-2'), kinds: MUTED_KINDS, events: [well(WELL_AT, 2)] };

  function world(opts: { rocks?: { x: number; y: number }[] } = {}): World {
    return new World({
      seed: 3,
      field: FIELD,
      rules: { kind: 'galaxy', galaxy: calm, mode: 'free' },
      ...(opts.rocks === undefined ? {} : { initialAsteroids: opts.rocks.map(({ x, y }) => ({ x, y, size: 1 as const, angle: 0, speedMultiplier: 0 })) }),
    });
  }

  function until(w: World, done: (events: readonly SimEvent[]) => boolean): SimEvent[] {
    const seen: SimEvent[] = [];
    for (let i = 0; i < 60 * 120 && w.status === 'playing'; i++) {
      const events = w.step(DT, NO_CONTROLS);
      seen.push(...events.map((e) => ({ ...e })));
      if (done(events)) break;
    }
    return seen;
  }

  it('shows the warning in `hazards`, then pulls the idle ship toward it', () => {
    const w = world();
    const seen = until(w, (events) => events.some((e) => e.type === 'wellWarning'));
    expect(seen.at(-1)).toMatchObject({ type: 'wellWarning', kind: 'gravityWell', at: WELL_AT });
    expect(w.hazards[0]).toMatchObject({ stage: 'warning' });
    const centre = w.hazards[0];
    if (centre === undefined) throw new Error('expected a well');
    const before = { x: w.ship.x, y: w.ship.y };
    until(w, (events) => events.some((e) => e.type === 'wellStart'));
    expect(w.hazards[0]).toMatchObject({ stage: 'active' });
    // The idle ship has not moved: it only drifts once pulled.
    expect(w.ship.x).toBeCloseTo(before.x, 6);
    for (let i = 0; i < 2 * 120; i++) w.step(DT, NO_CONTROLS);
    const toward = (w.ship.x - before.x) * (centre.x - before.x) + (w.ship.y - before.y) * (centre.y - before.y);
    expect(toward).toBeGreaterThan(0);
    expect(Math.hypot(w.ship.vx, w.ship.vy)).toBeGreaterThan(0);
  });

  it('pulls a rock toward the well too, through the same hazard path', () => {
    const w = world({ rocks: [{ x: 640, y: 100 }] });
    until(w, (events) => events.some((e) => e.type === 'wellStart'));
    const centre = w.hazards[0];
    if (centre === undefined) throw new Error('expected a well');
    const rock = w.asteroids[0];
    if (rock === undefined) throw new Error('expected the rock');
    const start = { x: rock.x, y: rock.y };
    for (let i = 0; i < 120; i++) w.step(DT, NO_CONTROLS);
    const after = w.asteroids[0];
    expect(Math.hypot((after?.x ?? 0) - centre.x, (after?.y ?? 0) - centre.y)).toBeLessThan(Math.hypot(start.x - centre.x, start.y - centre.y));
  });

  it('ends the well after 14 s, and the pull with it', () => {
    const w = world();
    const seen = until(w, (events) => events.some((e) => e.type === 'wellEnd'));
    expect(seen.filter((e) => e.type === 'wellStart')).toHaveLength(1);
    expect(w.hazards).toEqual([]);
    expect(w.elapsed).toBeCloseTo(WELL_AT + WELL_SECONDS, 1);
  });

  it('keeps a well inside the field, at the same place in it, when the field is resized mid-well', () => {
    const wide: Field = { width: 1680, height: 720 };
    const narrow: Field = { width: 960, height: 720 };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World({ seed, field: wide, rules: { kind: 'galaxy', galaxy: calm, mode: 'free' }, initialShip: { x: 100, y: 100, angle: 0 } });
      until(w, (events) => events.some((e) => e.type === 'wellStart'));
      // `hazards` is a live view: copy it before the resize moves it.
      const before = w.hazards[0] === undefined ? undefined : { ...w.hazards[0] };
      if (before === undefined) throw new Error('expected a well');
      w.resize(narrow);
      expect(w.hazards[0]?.x).toBeCloseTo(rescale(before.x, wide.width, narrow.width), 9);
      expect(w.hazards[0]?.y).toBeCloseTo(before.y, 9);
      expect(w.hazards[0]?.x).toBeGreaterThanOrEqual(0);
      expect(w.hazards[0]?.x).toBeLessThanOrEqual(narrow.width);
      expect(w.hazards[0]).toMatchObject({ id: before.id, stage: 'active' });
    }
  });

  it('reports no well in practice', () => {
    const w = new World({ seed: 1, field: FIELD, rules: { kind: 'practice', level: 1 } });
    expect(w.hazards).toEqual([]);
    expect(w.foes).toEqual([]);
  });

  it('clears the well, silently, when the galaxy warps out', () => {
    const w = new World({ seed: 3, field: FIELD, rules: { kind: 'galaxy', galaxy: { ...calm, duration: 24, events: [well(WELL_AT, 2)] }, mode: 'free' } });
    const seen = until(w, (events) => events.some((e) => e.type === 'warpOut'));
    expect(seen.some((e) => e.type === 'wellStart')).toBe(true);
    expect(seen.some((e) => e.type === 'wellEnd')).toBe(false);
    expect(w.hazards).toEqual([]);
  });
});

describe('a repulsion field', () => {
  const field = (at = WELL_AT, intensity: GalaxyEvent['intensity'] = 2): ForceField => forceField([{ at, type: 'repulsionField', intensity }], 1, 'repulsionField');

  /** The field `seconds` in, and where it sits. */
  function placed(w: ForceField, seconds: number): { x: number; y: number } {
    trace(w, seconds);
    const state = stateOf(w);
    if (state === null) throw new Error('expected a repulsion field');
    return state;
  }

  it('is a well of the opposite sign: it pushes each body away exactly as hard as a well pulls it in', () => {
    const repel = field();
    const attract = forceField([well(WELL_AT)], 1);
    const at = placed(repel, WELL_AT + 0.5);
    expect(placed(attract, WELL_AT + 0.5)).toMatchObject({ x: at.x, y: at.y });
    for (const [dx, dy] of [[200, 0], [-30, 80], [5, 5], [600, -300]] as const) {
      const pushed = body(at.x + dx, at.y + dy);
      const pulled = body(at.x + dx, at.y + dy);
      const shipPushed = pull(repel, DT, [pushed], [], body(at.x - dx, at.y - dy));
      const shipPulled = pull(attract, DT, [pulled], [], body(at.x - dx, at.y - dy));
      // Exact negation: each sum is exactly 0 (comparing with -x would tell 0 from -0).
      expect([pushed.vx + pulled.vx, pushed.vy + pulled.vy, shipPushed.x + shipPulled.x, shipPushed.y + shipPulled.y]).toEqual([0, 0, 0, 0]);
      expect(Math.abs(pushed.vx) + Math.abs(pushed.vy)).toBeGreaterThan(0);
      expect(pushed.vx * dx + pushed.vy * dy).toBeGreaterThan(0);
    }
  });

  it('keeps the well\'s caps: 140 units/s² and a push to 300 units/s at most', () => {
    const w = field(WELL_AT, 3);
    const at = placed(w, WELL_AT + 0.5);
    const close = body(at.x + 5, at.y + 5);
    pull(w, 1, [close]);
    expect(Math.hypot(close.vx, close.vy)).toBeCloseTo(WELL_MAX_ACCEL, 9);
    const rock = body(at.x + 100, at.y, 299.9, 0);
    for (let i = 0; i < 100; i++) pull(w, DT, [rock]);
    expect(Math.hypot(rock.vx, rock.vy)).toBeLessThanOrEqual(WELL_SPEED_CAP + 1e-9);
  });

  it('runs its own schedule and tells its events apart by kind', () => {
    const log = trace(field(), 40);
    expect(log.map((b) => b.event)).toEqual([
      expect.objectContaining({ type: 'wellWarning', id: 1, kind: 'repulsionField', at: WELL_AT }),
      { type: 'wellStart', id: 1, kind: 'repulsionField' },
      { type: 'wellEnd', id: 1, kind: 'repulsionField' },
    ]);
    expect(log[1]?.elapsed).toBeCloseTo(WELL_AT, 1);
    expect(log[2]?.elapsed).toBeCloseTo(WELL_AT + HAZARD_RULES.repulsionField.seconds, 1);
  });

  it('reports its state as a repulsion field', () => {
    const w = field();
    trace(w, WELL_AT - 1);
    expect(stateOf(w)).toMatchObject({ type: 'repulsionField', stage: 'warning', intensity: 2 });
  });
});
