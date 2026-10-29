import { describe, expect, it } from 'vitest';
import { BOLT } from '../../src/content/foes';
import { BLACK_HOLE, WARP_RIFT } from '../../src/content/hazards';
import type { GalaxyEvent } from '../../src/content/types';
import { ASTEROID, FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER, STEP_SECONDS, WRAP_MARGIN } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import { boxesOverlap, zoneClearance, zoneKeepOutBoxes } from '../../src/sim/hazards/dangerZone';
import type { HazardState, PointHazardState, RiftState, ZoneState } from '../../src/sim/hazards/hazard';
import { hazardStreams, HazardField } from '../../src/sim/hazards/hazardField';
import { cornerClearance } from '../../src/sim/hazards/placement';
import { MOUTH_SPACING } from '../../src/sim/hazards/warpRift';
import { RESPAWN_MARGIN } from '../../src/sim/respawn';
import { createShip, type Ship } from '../../src/sim/ship';
import { rescale, rescalePose } from '../../src/sim/wrap';
import { hazardFoes } from '../helpers/foeAt';

const FIELD_169: Field = { width: 1280, height: 720 };
const FIELD_43: Field = { width: FIELD_HEIGHT * MIN_ASPECT, height: FIELD_HEIGHT };
const FIELD_219: Field = { width: FIELD_HEIGHT * MAX_ASPECT, height: FIELD_HEIGHT };
/** The resizes a player makes mid-run: a 16:9 window squeezed to 4:3, then stretched out to 21:9. */
const RESIZES: readonly (readonly [Field, Field])[] = [
  [FIELD_169, FIELD_43],
  [FIELD_43, FIELD_219],
];
const DT = STEP_SECONDS;
/** How far round the field's centre placed hazards keep out (as `HazardField` keeps them). */
const CENTRE_KEEP_OUT = 150;
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);

/** How far from the hole's centre a mouth must sit for a ship leaving it to land `exit` away: as the rift places them. */
const mouthFor = (exit: number): number => exit + PLAYER.radius + 2 + WARP_RIFT.radius;

interface Rig {
  readonly hazards: HazardField;
  readonly ship: Ship;
  readonly bolts: Bolts;
  /** The field the hazards are stepped in, as of the last resize. */
  field: Field;
}

/** A hazard field of `events` on a 16:9 field from `seed`, with bolts on that field and the ship at (x, y). */
function rig(events: readonly GalaxyEvent[], seed: number, ship: { x: number; y: number } = { x: 1280 / 2, y: 720 / 2 }): Rig {
  let lastId = 0;
  const nextId = (): number => ++lastId;
  const r: Rig = {
    hazards: new HazardField(events, hazardStreams(seed), nextId),
    ship: createShip(ship.x, ship.y),
    bolts: new Bolts({ events: [], field: () => r.field, nextId }),
    field: FIELD_169,
  };
  r.ship.invulnerable = false;
  return r;
}

/** Steps the hazards from `from` to `to` seconds in the rig's field, moving the bodies each step; returns the events pushed. */
function stepTo(r: Rig, from: number, to: number): SimEvent[] {
  const log: SimEvent[] = [];
  for (let i = Math.round(from / DT) + 1; i <= Math.round(to / DT); i++) {
    const out: SimEvent[] = [];
    r.bolts.step(DT);
    r.hazards.move(DT, r.ship, [], hazardFoes(), out, r.bolts);
    r.hazards.step(i * DT, r.field, out);
    log.push(...out);
  }
  return log;
}

/** Resizes the rig as the World does: the ship first, then the bolts and the hazards. */
function resize(r: Rig, old: Field, field: Field): void {
  rescalePose(r.ship, old, field);
  r.field = field;
  r.bolts.resize(old, field);
  r.hazards.resize(old, field);
}

const rifts = (states: readonly HazardState[]): RiftState[] => states.filter((s): s is RiftState => s.type === 'warpRift');
const zones = (states: readonly HazardState[]): ZoneState[] => states.filter((s): s is ZoneState => s.type === 'dangerZone');
const holes = (states: readonly HazardState[]): PointHazardState[] => states.filter((s): s is PointHazardState => s.type === 'blackHole');
const mouthsOf = (pair: RiftState): { x: number; y: number }[] => [
  { x: pair.x, y: pair.y },
  { x: pair.toX, y: pair.toY },
];

type Spot = Readonly<{ x: number; y: number }>;

/**
 * The rules a mouth at `mouth` breaks in `field` round a hole at its centre: its pair's other mouth at `partner`, the other
 * pairs' mouths at `others`.
 */
function mouthIssues(field: Field, ship: Ship, mouth: Spot, partner: Spot, others: readonly Spot[]): string[] {
  const issues: string[] = [];
  const fromHole = Math.hypot(mouth.x - field.width / 2, mouth.y - field.height / 2);
  if (fromHole < mouthFor(BLACK_HOLE.exitFallback)) issues.push(`is ${fromHole.toFixed(0)} from the hole, inside its exit reach`);
  if (cornerClearance(field, zoneKeepOutBoxes(field), mouth.x, mouth.y) < WARP_RIFT.radius) issues.push('lies under a HUD or thumb corner');
  if (mouth.x < WARP_RIFT.inset || mouth.x > field.width - WARP_RIFT.inset || mouth.y < WARP_RIFT.inset || mouth.y > field.height - WARP_RIFT.inset) issues.push("is off the field's inset");
  if (Math.hypot(mouth.x - ship.x, mouth.y - ship.y) < ASTEROID.safeRadius + WARP_RIFT.radius) issues.push('is on the ship');
  if (Math.hypot(mouth.x - partner.x, mouth.y - partner.y) < WARP_RIFT.apart * field.width) issues.push(`is closer to its pair than ${String(WARP_RIFT.apart)} of the width`);
  if (others.some((o) => Math.hypot(mouth.x - o.x, mouth.y - o.y) < MOUTH_SPACING)) issues.push('crowds another pair');
  return issues;
}

/** Each pair's mouths, and the other pairs' mouths beside each. */
function eachMouth(pairs: readonly RiftState[]): { name: string; mouth: Spot; partner: Spot; others: Spot[] }[] {
  return pairs.flatMap((pair, p) => {
    const others = pairs.filter((_, q) => q !== p).flatMap(mouthsOf);
    const [a, b] = mouthsOf(pair) as [Spot, Spot];
    return [
      { name: `pair ${String(p)} mouth 0`, mouth: a, partner: b, others },
      { name: `pair ${String(p)} mouth 1`, mouth: b, partner: a, others },
    ];
  });
}

/** What is wrong with the rift mouths in `field`: each broken rule, by mouth. */
function mouthProblems(states: readonly HazardState[], field: Field, ship: Ship): string[] {
  return eachMouth(rifts(states)).flatMap(({ name, mouth, partner, others }) => mouthIssues(field, ship, mouth, partner, others).map((issue) => `${name} ${issue}`));
}

/** `pair` as a resize from `old` to `field` stretches it, before anything moves it. */
const stretchedPair = (pair: RiftState, old: Field, field: Field): RiftState => ({
  ...pair,
  x: rescale(pair.x, old.width, field.width),
  toX: rescale(pair.toX, old.width, field.width),
});

/** A Singularity field: the hole at 12 s and a rift of two pairs at 22 s, stepped until both are open. */
function holeAndRift(seed: number): Rig {
  const r = rig(
    [
      { at: 12, type: 'blackHole', intensity: 3 },
      { at: 22, type: 'warpRift', intensity: 2 },
    ],
    seed,
    { x: 300, y: 560 },
  );
  stepTo(r, 0, 23);
  return r;
}

describe('a resize mid-run: rift mouths and the black hole', () => {
  it('keeps every mouth out of the exit reach of the re-centred hole, the HUD and thumb corners and the ship, through 16:9 → 4:3 → 21:9', () => {
    for (const seed of SEEDS) {
      const r = holeAndRift(seed);
      expect(rifts(r.hazards.states), `seed ${String(seed)}`).toHaveLength(2);
      for (const [old, field] of RESIZES) {
        resize(r, old, field);
        expect(mouthProblems(r.hazards.states, field, r.ship), `seed ${String(seed)} at ${String(field.width)}`).toEqual([]);
      }
    }
  });

  it('moves only the mouths the stretch leaves breaking a rule, and keeps every pair, its id, its stage and its countdown', () => {
    let moved = 0;
    for (const seed of SEEDS) {
      const r = holeAndRift(seed);
      for (const [old, field] of RESIZES) {
        const before = rifts(r.hazards.states).map((pair) => ({ ...pair }));
        resize(r, old, field);
        const after = rifts(r.hazards.states);
        const timing = ({ id, stage, remaining }: RiftState) => ({ id, stage, remaining });
        expect(after.map(timing)).toEqual(before.map(timing));
        const stretched = eachMouth(before.map((pair) => stretchedPair(pair, old, field)));
        for (const [i, now] of eachMouth(after).entries()) {
          const was = stretched[i];
          if (was === undefined || (now.mouth.x === was.mouth.x && now.mouth.y === was.mouth.y)) continue;
          moved++;
          expect(mouthIssues(field, r.ship, was.mouth, was.partner, was.others), `seed ${String(seed)} at ${String(field.width)}: ${now.name}`).not.toEqual([]);
        }
      }
    }
    // The squeeze to 4:3 brings mouths into the hole's exit reach, so the rule above is not met by moving nothing.
    expect(moved).toBeGreaterThan(0);
  });

  it('keeps the hole at the centre of each field, active with its countdown, striking there and respawning the ship clear of it', () => {
    const r = holeAndRift(1);
    const [hole] = holes(r.hazards.states);
    if (hole === undefined) throw new Error('the hole should be in play');
    const { remaining, stage } = hole;
    for (const [old, field] of RESIZES) {
      resize(r, old, field);
      const centre = { x: field.width / 2, y: field.height / 2 };
      expect(holes(r.hazards.states)).toEqual([expect.objectContaining({ ...centre, stage, remaining })]);
      expect(r.hazards.strikes(centre.x, centre.y, PLAYER.radius)).toBe(true);
      const spot = r.hazards.respawnPoint();
      if (spot === null) throw new Error('the hole should move the respawn');
      expect(Math.hypot(spot.x - centre.x, spot.y - centre.y)).toBeGreaterThanOrEqual(BLACK_HOLE.exitReach + RESPAWN_MARGIN);
      expect(spot.x).toBeGreaterThanOrEqual(0);
      expect(spot.x).toBeLessThanOrEqual(field.width);
    }
  });
});

describe('a resize mid-run: live bolts', () => {
  /** A rig with the hole active and `count` bolts fired from across the field, heading every way. */
  function boltsInFlight(count: number): Rig {
    const r = rig([{ at: 5, type: 'blackHole', intensity: 1 }], 1);
    stepTo(r, 0, 6);
    for (let i = 0; i < count; i++) r.bolts.fire(100 + ((i * 97) % 1080), 80 + ((i * 53) % 560), (i * Math.PI) / 4, BOLT.speed, 'gunship', 1);
    return r;
  }

  it('keep their share of the wrap band, their heading and speed, and their last pose with them, through 16:9 → 4:3 → 21:9', () => {
    const r = boltsInFlight(12);
    for (const [old, field] of RESIZES) {
      const before = r.bolts.list.map((b) => ({ ...b }));
      resize(r, old, field);
      const share = (x: number, width: number): number => (x + WRAP_MARGIN) / (width + 2 * WRAP_MARGIN);
      for (const [i, bolt] of r.bolts.list.entries()) {
        const was = before[i];
        if (was === undefined) throw new Error('a bolt went missing on a resize');
        expect(share(bolt.x, field.width)).toBeCloseTo(share(was.x, old.width), 9);
        expect(share(bolt.px, field.width)).toBeCloseTo(share(was.px, old.width), 9);
        expect([bolt.y, bolt.py, bolt.vx, bolt.vy, bolt.age, bolt.id]).toEqual([was.y, was.py, was.vx, was.vy, was.age, was.id]);
      }
    }
  });

  it('still leave the new field rather than wrap, and the hole at its new centre still swallows them', () => {
    const r = boltsInFlight(0);
    resize(r, FIELD_169, FIELD_43);
    const outward = r.bolts.fire(FIELD_43.width - 10, 300, 0, BOLT.speed, 'gunship', 1);
    const inward = r.bolts.fire(FIELD_43.width / 2 - 100, FIELD_43.height / 2, 0, BOLT.speed, 'gunship', 1);
    if (outward === null || inward === null) throw new Error('the pool should have room');
    const ids = [outward.id, inward.id];
    stepTo(r, 6, 6.5);
    expect(r.bolts.list.filter((b) => ids.includes(b.id))).toEqual([]);
  });
});

describe('a resize mid-run: danger zones', () => {
  it('keeps every zone inside the field and off the HUD and thumb corners, through 16:9 → 4:3 → 21:9', () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      const r = rig([{ at: 20, type: 'dangerZone', intensity: 2 }], seed, { x: 200, y: 400 });
      stepTo(r, 0, 21);
      for (const [old, field] of RESIZES) {
        const stretched = zones(r.hazards.states).map((zone) => ({ x: rescale(zone.x, old.width, field.width), y: zone.y }));
        resize(r, old, field);
        const corners = zoneKeepOutBoxes(field);
        for (const [i, zone] of zones(r.hazards.states).entries()) {
          const where = `seed ${String(seed)} at ${String(field.width)}: zone ${String(zone.id)}`;
          if (corners.some((corner) => boxesOverlap(zone, corner))) problems.push(`${where} lies under a corner`);
          if (zone.x - zone.w / 2 < 0 || zone.x + zone.w / 2 > field.width || zone.y - zone.h / 2 < 0 || zone.y + zone.h / 2 > field.height) problems.push(`${where} leaves the field`);
          const was = stretched[i];
          if (was === undefined) throw new Error('a zone went missing on a resize');
          const moved = zone.x !== was.x || zone.y !== was.y;
          // A zone that moves lands clear of the ship and the field's centre, as it was placed.
          if (moved && zoneClearance(field, zone, r.ship.x, r.ship.y) < ASTEROID.safeRadius) problems.push(`${where} moved onto the ship`);
          if (moved && zoneClearance(field, zone, field.width / 2, field.height / 2) < CENTRE_KEEP_OUT) problems.push(`${where} moved onto the centre`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('a run that never changes size', () => {
  it('is the same whether or not it is "resized" to the field it already has', () => {
    const events: GalaxyEvent[] = [
      { at: 12, type: 'blackHole', intensity: 3 },
      { at: 22, type: 'warpRift', intensity: 2 },
      { at: 60, type: 'dangerZone', intensity: 2 },
    ];
    const still = rig(events, 5, { x: 300, y: 560 });
    const nudged = rig(events, 5, { x: 300, y: 560 });
    const log = stepTo(still, 0, 30);
    const nudgedLog: SimEvent[] = [];
    for (const [from, to] of [
      [0, 10],
      [10, 23],
      [23, 30],
    ] as const) {
      nudgedLog.push(...stepTo(nudged, from, to));
      resize(nudged, FIELD_169, FIELD_169);
    }
    expect(nudgedLog).toEqual(log);
    log.push(...stepTo(still, 30, 75));
    nudgedLog.push(...stepTo(nudged, 30, 62));
    resize(nudged, FIELD_169, FIELD_169);
    nudgedLog.push(...stepTo(nudged, 62, 75));
    expect(nudgedLog).toEqual(log);
    expect(nudged.hazards.states).toEqual(still.hazards.states);
  });
});
