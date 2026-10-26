import { describe, expect, it } from 'vitest';
import { eventSeconds } from '../../src/content/curves';
import { GALAXIES, galaxyById } from '../../src/content/galaxies';
import { WELL_MAX_ACCEL, WELL_MIN_RADIUS, WELL_SECONDS, WELL_SPEED_CAP, WELL_STRENGTH, WELL_TELEGRAPH_SECONDS } from '../../src/content/hazards';
import { lullStart, LULL_SECONDS } from '../../src/content/pacingRules';
import type { FoeKind, GalaxyDef, GalaxyEvent } from '../../src/content/types';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { FoePool, type Foe } from '../../src/sim/foes/foe';
import { wellAcceleration, Wells, type Pullable } from '../../src/sim/hazards/gravityWell';
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

function wells(events: readonly GalaxyEvent[], seed = 1): { wells: Wells; ids: () => number } {
  let last = 0;
  return { wells: new Wells(events, createRng(seed), () => ++last), ids: () => last };
}

interface Beat {
  readonly event: SimEvent;
  readonly elapsed: number;
}

/** Steps a schedule through `seconds` at the fixed step, logging each event with the elapsed time of its step. */
function trace(w: Wells, seconds: number): Beat[] {
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
  it('is k / max(r, 60)^2, k being 1,000,000 times the intensity', () => {
    expect(WELL_STRENGTH).toBe(1_000_000);
    expect(wellAcceleration(300, 1)).toBeCloseTo(1_000_000 / 300 ** 2, 10);
    expect(wellAcceleration(200, 2)).toBeCloseTo(50, 10);
    expect(wellAcceleration(400, 3)).toBeCloseTo(18.75, 10);
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

  it('holds the cap out to sqrt(k / 140) from the centre: about 85, 120 and 146 units at intensity 1, 2 and 3', () => {
    for (const [intensity, reach] of [[1, 84.5], [2, 119.5], [3, 146.4]] as const) {
      expect(wellAcceleration(reach - 1, intensity), String(intensity)).toBe(140);
      expect(wellAcceleration(reach + 1, intensity), String(intensity)).toBeLessThan(140);
    }
  });
});

describe('Wells schedule', () => {
  it('draws a well 2 s ahead, then starts it on time and ends it 14 s later, with matching ids', () => {
    const { wells: w } = wells([well(WELL_AT)]);
    const log = trace(w, 40);
    expect(log.map((b) => b.event.type)).toEqual(['wellWarning', 'wellStart', 'wellEnd']);
    const [warning, start, end] = log;
    expect(warning?.elapsed).toBeCloseTo(WELL_AT - WELL_TELEGRAPH_SECONDS, 1);
    expect(warning?.event).toMatchObject({ type: 'wellWarning', at: WELL_AT });
    expect(start?.elapsed).toBeCloseTo(WELL_AT, 1);
    expect(end?.elapsed).toBeCloseTo(WELL_AT + WELL_SECONDS, 1);
    expect(WELL_TELEGRAPH_SECONDS).toBe(2);
    expect(WELL_SECONDS).toBe(14);
    expect(start?.event).toMatchObject({ id: 1 });
    expect(end?.event).toMatchObject({ id: 1 });
  });

  it('does not pull during its warning, and draws it where it will be', () => {
    const { wells: w } = wells([well(WELL_AT)]);
    const log = trace(w, WELL_AT - 1);
    expect(w.state).toMatchObject({ stage: 'warning' });
    const warning = log[0]?.event;
    expect(warning).toMatchObject({ type: 'wellWarning' });
    if (warning?.type !== 'wellWarning') return;
    expect(w.state).toMatchObject({ x: warning.x, y: warning.y });
    const ship = body(warning.x + 100, warning.y);
    w.pull(DT, ship, [], []);
    expect(ship.vx).toBe(0);
    expect(w.state?.remaining).toBeCloseTo(1, 1);
  });

  it('places the well inside the field, clear of its edges, from the hazards stream alone', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const log = trace(wells([well(WELL_AT)], seed).wells, 19);
      const warning = log[0]?.event;
      if (warning?.type !== 'wellWarning') throw new Error('expected a warning');
      expect(warning.x).toBeGreaterThanOrEqual(FIELD.width * 0.25);
      expect(warning.x).toBeLessThanOrEqual(FIELD.width * 0.75);
      expect(warning.y).toBeGreaterThanOrEqual(FIELD.height * 0.25);
      expect(warning.y).toBeLessThanOrEqual(FIELD.height * 0.75);
    }
    const place = (seed: number): SimEvent | undefined => trace(wells([well(WELL_AT)], seed).wells, 19)[0]?.event;
    expect(place(4)).toEqual(place(4));
    expect(place(4)).not.toEqual(place(5));
  });

  it('runs a galaxy\'s wells in turn and ignores its showers', () => {
    const events: GalaxyEvent[] = [{ at: 10, type: 'meteorShower', intensity: 1 }, well(25), well(45)];
    const log = trace(wells(events).wells, 70);
    expect(log.map((b) => b.event.type)).toEqual(['wellWarning', 'wellStart', 'wellEnd', 'wellWarning', 'wellStart', 'wellEnd']);
  });

  it('stops at once and silently when the galaxy ends', () => {
    const { wells: w } = wells([well(WELL_AT), well(60)]);
    trace(w, WELL_AT + 3);
    expect(w.state).toMatchObject({ stage: 'active' });
    w.stop();
    expect(w.state).toBeNull();
    const out: SimEvent[] = [];
    w.step(60, FIELD, out);
    expect(out).toEqual([]);
    const ship = body(10, 10);
    w.pull(DT, ship, [], []);
    expect(ship.vx).toBe(0);
  });

  it('never lets a well fall in the lull: every well of every galaxy has ended by the time the lull starts', () => {
    let checked = 0;
    for (const g of GALAXIES) {
      const log = trace(wells(g.events).wells, g.duration);
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

describe('Wells pull', () => {
  function active(intensity: GalaxyEvent['intensity'] = 2) {
    const { wells: w } = wells([well(WELL_AT, intensity)]);
    const log = trace(w, WELL_AT + 0.5);
    const warning = log[0]?.event;
    if (warning?.type !== 'wellWarning') throw new Error('expected a warning');
    return { w, x: warning.x, y: warning.y };
  }

  it('nudges a still body toward the well by exactly a x dt', () => {
    const { w, x, y } = active(1);
    const rock = body(x + 200, y);
    w.pull(DT, rock, [], []);
    expect(rock.vx).toBeCloseTo(-wellAcceleration(200, 1) * DT, 12);
    expect(rock.vy).toBeCloseTo(0, 12);
    const below = body(x, y - 100);
    w.pull(DT, below, [], []);
    expect(below.vy).toBeCloseTo(wellAcceleration(100, 1) * DT, 12);
  });

  it('caps the nudge at 140 units/s^2 even in a strong well, right on top of it', () => {
    const { w, x, y } = active(3);
    const close = body(x + 5, y + 5);
    w.pull(1, close, [], []);
    expect(Math.hypot(close.vx, close.vy)).toBeLessThanOrEqual(WELL_MAX_ACCEL + 1e-9);
    expect(Math.hypot(close.vx, close.vy)).toBeCloseTo(140, 9);
  });

  it('pulls the ship, every rock and a splitter, but not a drone', () => {
    const { w, x, y } = active(1);
    const ship = body(x + 150, y);
    const rocks = [body(x, y + 150), body(x - 150, y)];
    const pool = new FoePool(2);
    const splitter = foeAt(pool, 'splitter', x, y - 150);
    const drone = foeAt(pool, 'drone', x + 150, y + 150);
    w.pull(DT, ship, rocks, [splitter, drone]);
    expect(ship.vx).toBeLessThan(0);
    expect(rocks[0]?.vy).toBeLessThan(0);
    expect(rocks[1]?.vx).toBeGreaterThan(0);
    expect(splitter.vy).toBeGreaterThan(0);
    expect(drone).toMatchObject({ vx: 0, vy: 0 });
  });

  it('lets a pull speed a body up to 300 and no further, but never slows a body that is already faster', () => {
    const { w, x, y } = active(3);
    const rock = body(x + 100, y, -299.9, 0);
    for (let i = 0; i < 100; i++) w.pull(DT, rock, [], []);
    expect(Math.hypot(rock.vx, rock.vy)).toBeLessThanOrEqual(WELL_SPEED_CAP + 1e-9);
    const fast = body(x + 100, y, -340, 0);
    w.pull(DT, fast, [], []);
    expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(340, 9);
  });

  it('skips a body exactly at the centre rather than dividing by zero', () => {
    const { w, x, y } = active(2);
    const rock = body(x, y, 3, 4);
    w.pull(DT, rock, [], []);
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

  it('shows the warning in `well`, then pulls the idle ship toward it', () => {
    const w = world();
    const seen = until(w, (events) => events.some((e) => e.type === 'wellWarning'));
    expect(seen.at(-1)).toMatchObject({ type: 'wellWarning', at: WELL_AT });
    expect(w.well).toMatchObject({ stage: 'warning' });
    const centre = w.well;
    if (centre === null) throw new Error('expected a well');
    const before = { x: w.ship.x, y: w.ship.y };
    until(w, (events) => events.some((e) => e.type === 'wellStart'));
    expect(w.well).toMatchObject({ stage: 'active' });
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
    const centre = w.well;
    if (centre === null) throw new Error('expected a well');
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
    expect(w.well).toBeNull();
    expect(w.elapsed).toBeCloseTo(WELL_AT + WELL_SECONDS, 1);
  });

  it('keeps a well inside the field, at the same place in it, when the field is resized mid-well', () => {
    const wide: Field = { width: 1680, height: 720 };
    const narrow: Field = { width: 960, height: 720 };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World({ seed, field: wide, rules: { kind: 'galaxy', galaxy: calm, mode: 'free' }, initialShip: { x: 100, y: 100, angle: 0 } });
      until(w, (events) => events.some((e) => e.type === 'wellStart'));
      // `well` is a live view: copy it before the resize moves it.
      const before = w.well === null ? null : { ...w.well };
      if (before === null) throw new Error('expected a well');
      w.resize(narrow);
      expect(w.well?.x).toBeCloseTo(rescale(before.x, wide.width, narrow.width), 9);
      expect(w.well?.y).toBeCloseTo(before.y, 9);
      expect(w.well?.x).toBeGreaterThanOrEqual(0);
      expect(w.well?.x).toBeLessThanOrEqual(narrow.width);
      expect(w.well).toMatchObject({ id: before.id, stage: 'active' });
    }
  });

  it('reports no well in practice', () => {
    const w = new World({ seed: 1, field: FIELD, rules: { kind: 'practice', level: 1 } });
    expect(w.well).toBeNull();
    expect(w.foes).toEqual([]);
  });

  it('clears the well, silently, when the galaxy warps out', () => {
    const w = new World({ seed: 3, field: FIELD, rules: { kind: 'galaxy', galaxy: { ...calm, duration: 24, events: [well(WELL_AT, 2)] }, mode: 'free' } });
    const seen = until(w, (events) => events.some((e) => e.type === 'warpOut'));
    expect(seen.some((e) => e.type === 'wellStart')).toBe(true);
    expect(seen.some((e) => e.type === 'wellEnd')).toBe(false);
    expect(w.well).toBeNull();
  });
});
