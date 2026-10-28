import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import type { GalaxyEvent } from '../../src/content/types';
import { STEP_SECONDS } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import { REFERENCE_AREA } from '../../src/sim/galaxy/director';
import { eventsOfType, SHOWER_WARNING_SECONDS, showerSeconds } from '../../src/content/curves';
import { EDGE_BEARINGS, showerCap, showerRate, Showers, type ShowerState } from '../../src/sim/galaxy/showers';
import { createRng } from '../../src/sim/rng';

const AREA = 1280 * 720;

interface Trace {
  readonly events: readonly (SimEvent & { readonly elapsed: number })[];
  readonly rocks: readonly number[];
  readonly states: readonly ShowerState[];
}

/**
 * Steps a schedule from 0 to `seconds` at the fixed step, collecting its events and the elapsed time of every rock.
 * Each rock stays on the field for `stay` seconds (0: it is gone by the next step).
 */
function trace(events: readonly GalaxyEvent[], seed: number, seconds: number, area = AREA, stay = 0): Trace {
  const showers = new Showers(events, createRng(seed));
  const out: SimEvent[] = [];
  const log: (SimEvent & { elapsed: number })[] = [];
  const rocks: number[] = [];
  const states: ShowerState[] = [];
  const steps = Math.round(seconds / STEP_SECONDS);
  for (let i = 1; i <= steps; i++) {
    const elapsed = i * STEP_SECONDS;
    out.length = 0;
    const onField = rocks.filter((t) => elapsed - t < stay).length;
    const count = showers.step(elapsed, STEP_SECONDS, area, onField, out);
    for (let r = 0; r < count; r++) rocks.push(elapsed);
    for (const e of out) log.push({ ...e, elapsed });
    if (showers.state !== null) states.push({ ...showers.state });
  }
  return { events: log, rocks, states };
}

const ONE: readonly GalaxyEvent[] = galaxyById('1-4').events; // at 50, intensity 1

describe('shower timing', () => {
  it('lasts min(12, 6 + 3 x intensity) seconds', () => {
    expect([1, 2, 3].map((i) => showerSeconds(i as 1 | 2 | 3))).toEqual([9, 12, 12]);
  });

  it('warns 3 s ahead, then starts and ends on schedule', () => {
    const { events } = trace(ONE, 1, 70);
    expect(events.map((e) => e.type)).toEqual(['showerWarning', 'showerStart', 'showerEnd']);
    const [warning, start, end] = events;
    expect(warning?.elapsed).toBeCloseTo(50 - SHOWER_WARNING_SECONDS, 1);
    expect(warning).toMatchObject({ type: 'showerWarning', at: 50 });
    expect(start?.elapsed).toBeCloseTo(50, 1);
    expect(end?.elapsed).toBeCloseTo(50 + showerSeconds(1), 1);
  });

  it('runs every shower of a two-shower galaxy in turn', () => {
    const g = galaxyById('3-4');
    const { events } = trace(g.events, 1, g.duration);
    expect(events.filter((e) => e.type === 'showerStart').map((e) => Math.round(e.elapsed))).toEqual(eventsOfType(g.events, 'meteorShower').map((e) => e.at));
    expect(events.filter((e) => e.type === 'showerEnd')).toHaveLength(2);
  });

  it('reports the warning and the active shower for the HUD, counting down', () => {
    const { states } = trace(ONE, 1, 70);
    expect(states[0]).toMatchObject({ stage: 'warning' });
    expect(states[0]?.remaining).toBeCloseTo(SHOWER_WARNING_SECONDS, 1);
    const active = states.filter((s) => s.stage === 'active');
    expect(active[0]?.remaining).toBeCloseTo(showerSeconds(1), 1);
    expect(active.at(-1)?.remaining).toBeGreaterThan(0);
  });

  it('spawns nothing outside the shower', () => {
    const { rocks } = trace(ONE, 1, 70);
    expect(rocks.length).toBeGreaterThan(0);
    for (const t of rocks) {
      expect(t).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(t).toBeLessThanOrEqual(50 + showerSeconds(1) + 1e-9);
    }
  });
});

describe('shower direction', () => {
  it('rolls one edge per shower, given as its bearing from the field centre', () => {
    const angles = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const warning = trace(ONE, seed, 48).events.find((e) => e.type === 'showerWarning');
      if (warning?.type !== 'showerWarning') throw new Error('no warning');
      expect(EDGE_BEARINGS).toContain(warning.angle);
      angles.add(warning.angle);
    }
    expect(angles.size).toBe(4);
  });

  it('keeps the edge from the warning through the whole shower', () => {
    const { states, events } = trace(ONE, 5, 70);
    const warning = events.find((e) => e.type === 'showerWarning');
    if (warning?.type !== 'showerWarning') throw new Error('no warning');
    expect(new Set(states.map((s) => s.angle))).toEqual(new Set([warning.angle]));
  });
});

describe('shower density', () => {
  it('drops (2 + intensity) rocks per second at the reference area', () => {
    expect(showerRate(1, REFERENCE_AREA)).toBe(3);
    expect(showerRate(3, REFERENCE_AREA)).toBe(5);
  });

  it.each([1, 2, 3] as const)('never spawns more than the cap at intensity %i, and does reach it', (intensity) => {
    const events: GalaxyEvent[] = [{ at: 30, type: 'meteorShower', intensity }];
    const cap = showerRate(intensity, AREA) * showerSeconds(intensity);
    const { rocks } = trace(events, 2, 50);
    expect(rocks.length).toBeLessThanOrEqual(Math.ceil(cap));
    expect(rocks.length).toBeGreaterThanOrEqual(Math.floor(cap) - 1);
    // ...and never bunches more than one second's worth into any second.
    for (const t of rocks) expect(rocks.filter((u) => u >= t && u < t + 1 - 1e-6).length).toBeLessThanOrEqual(Math.ceil(showerRate(intensity, AREA)));
  });

  it.each([1, 2, 3] as const)('holds at most (5 + 2 x intensity) rocks on the field at intensity %i, dropping the rest', (intensity) => {
    const events: GalaxyEvent[] = [{ at: 30, type: 'meteorShower', intensity }];
    expect(showerCap(intensity, REFERENCE_AREA)).toBe(5 + 2 * intensity);
    // Rocks that never leave: the cap is all the shower can ever drop.
    expect(trace(events, 2, 50, AREA, 1000).rocks).toHaveLength(Math.floor(showerCap(intensity, AREA)));
    // Rocks that cross in 2 s: the field never holds more than the cap.
    const { rocks } = trace(events, 2, 50, AREA, 2);
    for (const t of rocks) expect(rocks.filter((u) => u <= t && t - u < 2).length).toBeLessThanOrEqual(showerCap(intensity, AREA));
    expect(rocks.length).toBeGreaterThan(showerCap(intensity, AREA));
  });

  it('scales the field cap with area', () => {
    expect(showerCap(2, 1680 * 720) / showerCap(2, 960 * 720)).toBeCloseTo(1680 / 960, 10);
  });

  it('scales with field area', () => {
    const narrow = trace(ONE, 3, 70, 960 * 720).rocks.length;
    const wide = trace(ONE, 3, 70, 1680 * 720).rocks.length;
    expect(wide / narrow).toBeCloseTo(1680 / 960, 0);
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('Showers validation', () => {
  it('rejects a non-positive field area, saying what to pass', () => {
    expect(() => new Showers(ONE, createRng(1)).step(1, STEP_SECONDS, 0, 0, [])).toThrow(/fieldArea.*positive/);
  });
});

describe('Showers.stop', () => {
  it('ends the warning or shower at once, quietly, and runs no more', () => {
    const showers = new Showers(galaxyById('3-4').events, createRng(1));
    const out: SimEvent[] = [];
    const first = eventsOfType(galaxyById('3-4').events, 'meteorShower')[0]?.at ?? 0;
    showers.step(first, STEP_SECONDS, AREA, 0, out);
    expect(showers.state?.stage).toBe('active');
    showers.stop();
    expect(showers.state).toBeNull();
    out.length = 0;
    for (let t = first; t < 200; t += 0.5) showers.step(t, STEP_SECONDS, AREA, 0, out);
    expect(out).toEqual([]);
  });
});

describe('a schedule with gravity wells', () => {
  it('takes only the meteor showers from it, in order', () => {
    const events: GalaxyEvent[] = [{ at: 20, type: 'gravityWell', intensity: 2 }, { at: 50, type: 'meteorShower', intensity: 1 }, { at: 80, type: 'gravityWell', intensity: 1 }];
    const { events: log } = trace(events, 1, 100);
    expect(log.map((e) => e.type)).toEqual(['showerWarning', 'showerStart', 'showerEnd']);
    expect(log[1]?.elapsed).toBeCloseTo(50, 1);
  });

  it('runs a Dimension 2 galaxy\'s showers on their own times, wells aside', () => {
    const g = galaxyById('2-4');
    const showerTimes = g.events.filter((e) => e.type === 'meteorShower').map((e) => e.at);
    const { events: log } = trace(g.events, 1, g.duration);
    expect(log.filter((e) => e.type === 'showerStart').map((e) => Math.round(e.elapsed))).toEqual(showerTimes);
  });
});
