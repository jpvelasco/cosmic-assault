import { describe, expect, it } from 'vitest';
import { BOSSES } from '../../src/content/bosses';
import { DIMENSIONS, GALAXIES, galaxyById, galaxyLabel, galaxyOrdinal, isGalaxyId, nextGalaxyId, tierOf } from '../../src/content/galaxies';
import type { GalaxyDef, GalaxyId, RockKind } from '../../src/content/types';
import { showerSeconds } from '../../src/content/curves';
import { lullStart } from '../../src/content/pacingRules';
import { phaseAt } from '../../src/sim/galaxy/pacing';
import { SHOWER_WARNING_SECONDS } from '../../src/sim/galaxy/showers';

const KINDS: readonly RockKind[] = ['large', 'medium', 'small'];
const survival = GALAXIES.filter((g) => g.kind === 'survival');

describe('the galaxy table', () => {
  it('holds 30 galaxies in order, five Dimensions of six', () => {
    expect(GALAXIES).toHaveLength(30);
    const ids = GALAXIES.map((g) => g.id);
    expect(ids).toEqual(Array.from({ length: 30 }, (_, n) => `${String(Math.floor(n / 6) + 1)}-${String((n % 6) + 1)}`));
    expect(new Set(ids).size).toBe(30);
  });

  it('agrees with itself: id, dimension and index', () => {
    for (const g of GALAXIES) expect(g.id).toBe(`${String(g.dimension)}-${String(g.index)}`);
  });

  it('gives each Dimension exactly one boss galaxy, and it is the sixth', () => {
    for (let d = 1; d <= 5; d++) {
      const bosses = GALAXIES.filter((g) => g.dimension === d && g.kind === 'boss');
      expect(bosses.map((g) => g.index)).toEqual([6]);
    }
    expect(GALAXIES.filter((g) => g.index === 6).every((g) => g.kind === 'boss')).toBe(true);
  });

  it('lasts 90 + 15 per earlier Dimension for survival, and a 20 s approach for a boss', () => {
    for (const g of survival) expect(g.duration).toBe(90 + 15 * (g.dimension - 1));
    expect(survival.map((g) => g.duration).filter((s, n, all) => all.indexOf(s) === n)).toEqual([90, 105, 120, 135, 150]);
    for (const g of GALAXIES.filter((x) => x.kind === 'boss')) expect(g.duration).toBe(20);
  });

  it('keeps every event inside the window from 20 s in to 25 s before the end', () => {
    for (const g of GALAXIES)
      for (const e of g.events) {
        expect(e.at, `${g.id} at ${String(e.at)}`).toBeGreaterThanOrEqual(20);
        expect(e.at, `${g.id} at ${String(e.at)}`).toBeLessThanOrEqual(g.duration - 25);
      }
  });

  it('sorts events by time and keeps showers apart', () => {
    for (const g of GALAXIES) {
      const times = g.events.map((e) => e.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (let i = 1; i < times.length; i++) expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(10);
    }
  });

  it('schedules meteor showers as the brief lays out', () => {
    for (const id of ['1-1', '1-2', '1-3'] as const) expect(galaxyById(id).events).toEqual([]);
    expect(galaxyById('1-4').events).toEqual([{ at: 50, type: 'meteorShower', intensity: 1 }]);
    for (const g of survival.filter((x) => x.dimension > 1 || x.index === 5)) {
      expect(g.events.length, g.id).toBeGreaterThanOrEqual(1);
      expect(g.events.length, g.id).toBeLessThanOrEqual(2);
      for (const e of g.events) expect(e.intensity, g.id).toBe(Math.min(3, g.dimension));
    }
    for (const g of GALAXIES.filter((x) => x.kind === 'boss')) expect(g.events).toEqual([]);
  });

  it('keeps the lull clear: every shower ends by the time the lull starts (ending exactly then is allowed)', () => {
    for (const g of GALAXIES)
      for (const e of g.events) {
        expect(['lull', 'warp'], `${g.id} at ${String(e.at)}`).not.toContain(phaseAt(g, e.at));
        expect(e.at + showerSeconds(e.intensity), `${g.id} at ${String(e.at)}`).toBeLessThanOrEqual(lullStart(g));
      }
  });

  it('gives every shower its full warning: the next one is not telegraphed until the last has ended', () => {
    for (const g of GALAXIES)
      for (let i = 1; i < g.events.length; i++) {
        const [prev, next] = [g.events[i - 1], g.events[i]];
        if (prev === undefined || next === undefined) continue;
        expect(next.at - SHOWER_WARNING_SECONDS, g.id).toBeGreaterThanOrEqual(prev.at + showerSeconds(prev.intensity));
      }
  });

  it('puts a second shower at about 60% of the duration, or earlier, ending just as the lull starts', () => {
    for (const g of survival.filter((x) => x.events.length === 2)) {
      const second = g.events[1];
      if (second === undefined) continue;
      const end = second.at + showerSeconds(second.intensity);
      if (Math.abs(second.at - g.duration * 0.6) > 0.5) {
        expect(second.at, g.id).toBeLessThan(g.duration * 0.6);
        expect(end, g.id).toBe(lullStart(g));
      }
    }
    expect(galaxyById('1-5').events.map((e) => e.at)).toEqual([27, 51]);
  });

  it('has no pickups yet', () => {
    for (const g of GALAXIES) expect(g.pickups).toEqual([]);
  });

  it('points every boss galaxy at a boss that exists, and no survival galaxy at one', () => {
    for (const g of GALAXIES) {
      if (g.kind === 'boss') expect(g.boss).not.toBeNull();
      else expect(g.boss).toBeNull();
      if (g.boss !== null) expect(Object.keys(BOSSES)).toContain(g.boss);
    }
    expect(BOSSES.sentinel.name).toBe('Sentinel');
  });

  it('keeps every rock ramp a probability: 0 <= base <= max <= 1', () => {
    for (const g of GALAXIES)
      for (const kind of KINDS) {
        const { base, max, step, from } = g.kinds[kind];
        expect(base, `${g.id} ${kind}`).toBeGreaterThanOrEqual(0);
        expect(base, `${g.id} ${kind}`).toBeLessThanOrEqual(max);
        expect(max, `${g.id} ${kind}`).toBeLessThanOrEqual(1);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(from).toBeGreaterThanOrEqual(0);
      }
  });

  it('shares one ramp table instead of repeating it per galaxy', () => {
    const first = GALAXIES[0]?.kinds;
    expect(first).toEqual({
      large: { from: 0, base: 0.6, step: 0, max: 0.6 },
      medium: { from: 0, base: 0.3, step: 0.05, max: 0.5 },
      small: { from: 0.5, base: 0.1, step: 0.05, max: 0.4 },
    });
    for (const g of GALAXIES) expect(g.kinds).toBe(first);
  });

  it('uses the Drift palette throughout', () => {
    for (const g of GALAXIES) expect(g.palette).toBe('drift');
  });
});

describe('galaxyById', () => {
  it('finds a galaxy by id', () => {
    const g: GalaxyDef = galaxyById('3-4');
    expect(g).toMatchObject({ id: '3-4', dimension: 3, index: 4, kind: 'survival' });
  });

  it('throws, naming the id and the valid range, for one that does not exist', () => {
    expect(() => galaxyById('9-9' as GalaxyId)).toThrow(RangeError);
    expect(() => galaxyById('9-9' as GalaxyId)).toThrow(/9-9.*1-1.*5-6/);
  });
});

describe('galaxy order', () => {
  it('numbers galaxies 0 to 29 and walks to the next, crossing a Dimension after its boss', () => {
    expect(GALAXIES.map((g) => galaxyOrdinal(g.id))).toEqual(Array.from({ length: 30 }, (_, n) => n));
    expect(nextGalaxyId('1-1')).toBe('1-2');
    expect(nextGalaxyId('1-6')).toBe('2-1');
    expect(nextGalaxyId('5-6')).toBeNull();
    expect(GALAXIES.map((g) => nextGalaxyId(g.id))).toEqual([...GALAXIES.slice(1).map((g) => g.id), null]);
  });

  it('refuses ids outside the table', () => {
    expect(() => galaxyOrdinal('6-1' as GalaxyId)).toThrow(RangeError);
  });

  it('isGalaxyId accepts exactly the 30 ids', () => {
    expect(GALAXIES.every((g) => isGalaxyId(g.id))).toBe(true);
    for (const bad of ['6-1', '1-7', '0-1', '1-1 ', '', 11, null, undefined, {}]) expect(isGalaxyId(bad)).toBe(false);
  });
});

describe('tierOf', () => {
  it('counts Dimensions whole and galaxies in fifths', () => {
    expect(tierOf({ dimension: 1, index: 1 })).toBe(0);
    expect(tierOf({ dimension: 1, index: 6 })).toBe(1);
    expect(tierOf({ dimension: 3, index: 3 })).toBeCloseTo(2.4, 10);
    expect(tierOf({ dimension: 5, index: 6 })).toBe(5);
  });
});

describe('galaxyLabel', () => {
  it('writes a star for the sixth galaxy and the id for the rest', () => {
    expect(galaxyLabel('1-1')).toBe('1-1');
    expect(galaxyLabel('4-5')).toBe('4-5');
    expect(galaxyLabel('2-6')).toBe('2-★');
  });
});

describe('DIMENSIONS', () => {
  it('names the five Dimensions', () => {
    expect(DIMENSIONS).toEqual({ 1: 'The Drift', 2: 'Ion Reach', 3: 'Crimson Nebula', 4: 'Void Rift', 5: 'Singularity' });
  });
});
