import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { DANGER_ZONE, HAZARD_RULES } from '../../src/content/hazards';
import type { GalaxyEvent } from '../../src/content/types';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { zoneClearance } from '../../src/sim/hazards/dangerZone';
import type { HazardState, ZoneState } from '../../src/sim/hazards/hazard';
import { HazardField } from '../../src/sim/hazards/hazardField';
import { createRng } from '../../src/sim/rng';
import { createShip, type Ship } from '../../src/sim/ship';
import { World } from '../../src/sim/world';
import { MUTED_KINDS } from '../helpers/mute';
import { auditTelegraphs, type TimedEvent } from '../helpers/telegraphAudit';

const FIELD: Field = { width: 1280, height: 720 };
const FIELD_43: Field = { width: FIELD_HEIGHT * MIN_ASPECT, height: FIELD_HEIGHT };
const FIELD_219: Field = { width: FIELD_HEIGHT * MAX_ASPECT, height: FIELD_HEIGHT };
const DT = STEP_SECONDS;
const { telegraph: TELEGRAPH, seconds: SECONDS } = HAZARD_RULES.dangerZone;
const zone = (at: number, intensity: GalaxyEvent['intensity'] = 1): GalaxyEvent => ({ at, type: 'dangerZone', intensity });

const zonesOf = (states: readonly HazardState[]): ZoneState[] => states.filter((s): s is ZoneState => s.type === 'dangerZone');

/** Runs a hazard field of `events` with `ship` moved each step, to `seconds`, logging every event with its time. */
function play(events: readonly GalaxyEvent[], opts: { seed?: number; field?: Field; ship?: Ship; seconds?: number; each?: (hazards: HazardField, t: number) => void } = {}): { hazards: HazardField; log: TimedEvent[] } {
  const { seed = 1, field = FIELD, ship = createShip(field.width / 2, field.height / 2), seconds = 60, each } = opts;
  let last = 0;
  const hazards = new HazardField(events, () => createRng(seed), () => ++last);
  const log: TimedEvent[] = [];
  const out: SimEvent[] = [];
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    const t = i * DT;
    out.length = 0;
    hazards.move(DT, ship, [], []);
    hazards.step(t, field, out);
    for (const event of out) log.push({ elapsed: t, event: { ...event } });
    each?.(hazards, t);
  }
  return { hazards, log };
}

const ofType = <T extends SimEvent['type']>(log: readonly TimedEvent[], type: T): (TimedEvent & { event: Extract<SimEvent, { type: T }> })[] =>
  log.filter((l): l is TimedEvent & { event: Extract<SimEvent, { type: T }> } => l.event.type === type);

describe('zoneClearance', () => {
  const box = { x: 500, y: 300, w: 200, h: 100 };
  it('is the distance to the rectangle outside it and minus the distance to its nearest edge inside', () => {
    expect(zoneClearance(FIELD, box, 650, 300)).toBe(50);
    expect(zoneClearance(FIELD, box, 500, 400)).toBe(50);
    expect(zoneClearance(FIELD, box, 630, 390)).toBeCloseTo(50, 9);
    expect(zoneClearance(FIELD, box, 500, 300)).toBe(-50);
    expect(zoneClearance(FIELD, box, 590, 300)).toBe(-10);
  });

  it('measures across the wrap, as everything else does', () => {
    const edge = { x: FIELD.width - 60, y: 300, w: 100, h: 100 };
    // 10 from its right side to the field's edge, the margin either side, and 10 back in from the far edge's margin.
    expect(zoneClearance(FIELD, edge, -10, 300)).toBeCloseTo(10 + 2 * WRAP_MARGIN - 10, 9);
  });
});

describe('danger zones', () => {
  it('warn 2 s ahead with one zone per intensity, at most two, each 120 to 220 a side and inside the field, then start and end on time', () => {
    const { log } = play([zone(20, 1), zone(40, 2)]);
    const warnings = ofType(log, 'zoneWarning');
    expect(warnings).toHaveLength(3);
    warnings.forEach((w, i) => { expect(w.elapsed).toBeCloseTo([18, 38, 38][i] ?? 0, 6); });
    for (const { event } of warnings) {
      for (const side of [event.w, event.h]) {
        expect(side).toBeGreaterThanOrEqual(DANGER_ZONE.side[0]);
        expect(side).toBeLessThanOrEqual(DANGER_ZONE.side[1]);
      }
      expect(event.x - event.w / 2).toBeGreaterThanOrEqual(0);
      expect(event.x + event.w / 2).toBeLessThanOrEqual(FIELD.width);
      expect(event.y - event.h / 2).toBeGreaterThanOrEqual(0);
      expect(event.y + event.h / 2).toBeLessThanOrEqual(FIELD.height);
    }
    const ids = warnings.map((w) => w.event.id);
    expect(new Set(ids).size).toBe(3);
    const starts = [20, 40, 40];
    expect(ofType(log, 'zoneStart').map((s) => s.event.id)).toEqual(ids);
    expect(ofType(log, 'zoneEnd').map((s) => s.event.id)).toEqual(ids);
    ofType(log, 'zoneStart').forEach((s, i) => { expect(s.elapsed).toBeCloseTo(starts[i] ?? 0, 6); });
    ofType(log, 'zoneEnd').forEach((s, i) => { expect(s.elapsed).toBeCloseTo((starts[i] ?? 0) + SECONDS, 6); });
  });

  it('never shows more than two zones, whatever the intensity', () => {
    const { log } = play([zone(20, 3)], { seconds: 22 });
    expect(ofType(log, 'zoneWarning')).toHaveLength(DANGER_ZONE.maxZones);
  });

  it('keeps the two zones of one event apart', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { log } = play([zone(20, 2)], { seed, seconds: 19 });
      const [a, b] = ofType(log, 'zoneWarning').map((w) => w.event);
      if (a === undefined || b === undefined) throw new Error(`seed ${String(seed)} should show two zones`);
      const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
      expect(apart, `seed ${String(seed)}`).toBe(true);
    }
  });

  it('is harmless while it warns, and strikes a ship touching it once active', () => {
    let warned: ZoneState | null = null;
    const struck: boolean[] = [];
    play([zone(20)], {
      seconds: 25,
      each: (hazards, t) => {
        const [z] = zonesOf(hazards.states);
        if (z === undefined) return;
        warned ??= z;
        const inside = hazards.strikes(z.x, z.y, PLAYER.radius);
        if (t < 20 - 1e-6) expect(inside, `at ${t.toFixed(3)} s`).toBe(false);
        else struck.push(inside);
        // A ship just touching its edge is struck; one just clear of it is not.
        if (z.stage === 'active') {
          expect(hazards.strikes(z.x + z.w / 2 + PLAYER.radius - 0.5, z.y, PLAYER.radius)).toBe(true);
          expect(hazards.strikes(z.x + z.w / 2 + PLAYER.radius + 0.5, z.y, PLAYER.radius)).toBe(false);
        }
      },
    });
    expect(warned).not.toBeNull();
    expect(struck.length).toBeGreaterThan(0);
    expect(struck.every(Boolean)).toBe(true);
  });

  it('warns on the very step the zone before it ends, so back-to-back zones keep their whole telegraph (Task 1 N-2)', () => {
    const { log } = play([zone(20), zone(20 + SECONDS + TELEGRAPH)], { seconds: 45 });
    const firstEnd = ofType(log, 'zoneEnd')[0]?.elapsed ?? 0;
    const secondWarning = ofType(log, 'zoneWarning')[1]?.elapsed ?? 0;
    expect(secondWarning).toBe(firstEnd);
    const pairs = auditTelegraphs(log);
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) expect(pair.active - pair.warned).toBeCloseTo(TELEGRAPH, 6);
  });

  it('warns a back-to-back force field on the step the one before it ends, too', () => {
    const well = (at: number): GalaxyEvent => ({ at, type: 'gravityWell', intensity: 1 });
    const { log } = play([well(20), well(20 + HAZARD_RULES.gravityWell.seconds + HAZARD_RULES.gravityWell.telegraph)], { seconds: 60 });
    expect(ofType(log, 'wellWarning')[1]?.elapsed).toBe(ofType(log, 'wellEnd')[0]?.elapsed);
    for (const pair of auditTelegraphs(log)) expect(pair.active - pair.warned).toBeCloseTo(HAZARD_RULES.gravityWell.telegraph, 6);
  });

  it('keeps its place in the field when the field is resized', () => {
    const { hazards } = play([zone(20)], { seconds: 21 });
    const [z] = zonesOf(hazards.states);
    if (z === undefined) throw new Error('a zone should be active');
    const share = { x: z.x / FIELD.width, w: z.w };
    hazards.resize(FIELD, FIELD_219);
    expect((z.x + WRAP_MARGIN) / (FIELD_219.width + 2 * WRAP_MARGIN)).toBeCloseTo((share.x * FIELD.width + WRAP_MARGIN) / (FIELD.width + 2 * WRAP_MARGIN), 9);
    expect(z.w).toBe(share.w);
  });

  it('stops at once and silently when the galaxy ends', () => {
    const { hazards } = play([zone(20, 2)], { seconds: 21 });
    expect(zonesOf(hazards.states)).toHaveLength(2);
    hazards.stop();
    expect(hazards.states).toEqual([]);
  });

  describe.each([
    ['4:3', FIELD_43],
    ['16:9', FIELD],
    ['21:9', FIELD_219],
  ])('placement keep-outs at %s', (_name, field) => {
    it('never puts a zone within 150 of the field\'s centre, or within the safe radius of the ship as it warns', () => {
      const ships: (readonly [number, number])[] = [];
      for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) ships.push([(i / 6) * field.width, (j / 4) * field.height]);
      let zones = 0;
      for (const [x, y] of ships) {
        for (let seed = 1; seed <= 4; seed++) {
          const ship = createShip(x, y);
          const { log } = play([zone(20, 2)], { seed, field, ship, seconds: 18.5 });
          for (const { event } of ofType(log, 'zoneWarning')) {
            zones++;
            expect(zoneClearance(field, event, field.width / 2, field.height / 2), `ship (${String(x)}, ${String(y)}) seed ${String(seed)}`).toBeGreaterThanOrEqual(150);
            expect(zoneClearance(field, event, x, y), `ship (${String(x)}, ${String(y)}) seed ${String(seed)}`).toBeGreaterThanOrEqual(ASTEROID.safeRadius);
          }
        }
      }
      // Two zones fit on every field the game plays at, wherever the ship is.
      expect(zones).toBe(ships.length * 4 * 2);
    });
  });
});

describe('a danger zone in a galaxy', () => {
  /** A Crimson Nebula galaxy with a zone at 5 s and nothing else, the ship moved into it once it is active. */
  function inZone(shielded: boolean): readonly SimEvent[] {
    const galaxy = { ...galaxyById('3-2'), kinds: MUTED_KINDS, events: [zone(5)] };
    const world = new World({ seed: 3, field: FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' } });
    if (shielded) world['run']?.loadout.collect('shield');
    const seen: SimEvent[] = [];
    for (let i = 0; i < 8.5 / DT; i++) {
      const [z] = zonesOf(world.hazards);
      if (z?.stage === 'active') Object.assign(world['shipState'], { x: z.x, y: z.y, px: z.x, py: z.y });
      for (const event of world.step(DT, NO_CONTROLS)) seen.push({ ...event });
    }
    return seen;
  }

  it('is a hit on the ship once active, which the Shield absorbs', () => {
    const bare = inZone(false);
    expect(bare.filter((e) => e.type === 'shipHit').length).toBeGreaterThanOrEqual(1);
    const shielded = inZone(true);
    expect(shielded.filter((e) => e.type === 'shieldBroken')).toHaveLength(1);
    expect(shielded.findIndex((e) => e.type === 'shieldBroken')).toBeLessThan(shielded.findIndex((e) => e.type === 'shipHit'));
  });
});
