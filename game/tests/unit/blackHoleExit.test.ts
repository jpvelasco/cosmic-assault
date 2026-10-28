import { describe, expect, it } from 'vitest';
import { BLACK_HOLE, WARP_RIFT } from '../../src/content/hazards';
import { FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT, PLAYER } from '../../src/sim/config';
import type { GalaxyEvent } from '../../src/content/types';
import type { Field } from '../../src/sim/field';
import { HazardField, hazardStreams } from '../../src/sim/hazards/hazardField';
import type { SimEvent } from '../../src/sim/events';
import { canEscape } from '../helpers/holeEscape';

/** A reaction a player takes to a body that has just been sent at them, in seconds. */
const REACTION_SECONDS = 0.35;
/** The gap a jumping body is put beyond its mouth, as `warpRift.ts` places it for a ship. */
const SHIP_EXIT_GAP = WARP_RIFT.radius + PLAYER.radius + 2;
const FIELDS: readonly Field[] = [MIN_ASPECT, 16 / 9, MAX_ASPECT].map((aspect) => ({ width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT }));
const CENTRE = (field: Field) => ({ x: field.width / 2, y: field.height / 2 });

/**
 * The least distance from the hole a ship heading straight in at `speed` can escape from, turning through the reaction
 * and thrusting after it (by bisection): about 256 at top speed. A ship that does not turn until the reaction is over
 * needs about 292; `exitReach` sits between the two.
 */
function leastSurvivable(speed: number, field: Field): number {
  const c = CENTRE(field);
  let lo: number = BLACK_HOLE.horizon;
  let hi = 400;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (canEscape({ x: c.x + mid, y: c.y, vx: -speed, vy: 0, angle: Math.PI }, 3, field, REACTION_SECONDS)) hi = mid;
    else lo = mid;
  }
  return hi;
}

describe('the exit reach of a black hole', () => {
  it('is at least the least distance a ship at top speed heading straight in survives from, after a reaction', () => {
    const field = FIELDS[0] as Field;
    const bound = leastSurvivable(PLAYER.maxSpeed, field);
    expect(BLACK_HOLE.exitReach).toBeGreaterThanOrEqual(bound);
    expect(BLACK_HOLE.exitReach - bound).toBeLessThan(40);
  }, 60_000);

  it('is the same at every aspect: the hole pulls the same wherever it sits, so the bound holds on each field', () => {
    for (const field of FIELDS) expect(BLACK_HOLE.exitReach, String(field.width)).toBeGreaterThanOrEqual(leastSurvivable(PLAYER.maxSpeed, field));
  }, 60_000);

  it('dooms no exit from a mouth at the keep-out distance: every heading and speed a ship can leave by survives its reaction', () => {
    const field = FIELDS[0] as Field;
    const c = CENTRE(field);
    // A mouth at the keep-out distance plus the mouth's own radius: 296 + 30. A ship leaving it heads out, in or across.
    const mouthAt = BLACK_HOLE.exitReach + PLAYER.radius + 2 + WARP_RIFT.radius;
    const doomed: string[] = [];
    for (let m = 0; m < 4; m++) {
      const mx = c.x + mouthAt * Math.cos((m * Math.PI) / 2);
      const my = c.y + mouthAt * Math.sin((m * Math.PI) / 2);
      for (let h = 0; h < 16; h++) {
        const heading = (h * Math.PI * 2) / 16;
        for (const speed of [100, 200, 300, PLAYER.maxSpeed]) {
          const x = mx + Math.cos(heading) * SHIP_EXIT_GAP;
          const y = my + Math.sin(heading) * SHIP_EXIT_GAP;
          const ok = canEscape({ x, y, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, angle: heading }, 3, field, REACTION_SECONDS);
          if (!ok) doomed.push(`mouth ${String(m)} heading ${String(h)} speed ${String(speed)}`);
        }
      }
    }
    expect(doomed).toEqual([]);
  }, 60_000);
});

describe('rift mouths and a black hole', () => {
  /** A galaxy's hole at 12 s and a rift of two pairs at 22 s, stepped past the rift's warning, and its mouths. */
  function riftsWithHole(field: Field, seed: number): { x: number; y: number; toX: number; toY: number }[] {
    let last = 0;
    const events: GalaxyEvent[] = [
      { at: 12, type: 'blackHole', intensity: 3 },
      { at: 22, type: 'warpRift', intensity: 2 },
    ];
    const hazards = new HazardField(events, hazardStreams(seed), () => ++last);
    const out: SimEvent[] = [];
    for (let t = 0; t <= 20; t += 1 / 120) hazards.step(t, field, out);
    return hazards.states.flatMap((s) => (s.type === 'warpRift' ? [{ x: s.x, y: s.y, toX: s.toX, toY: s.toY }] : []));
  }

  it('keeps every mouth at the exit reach, or else at the fallback on a crowded 4:3 field, and places both pairs on the wider fields', () => {
    const mouthFor = (exit: number): number => exit + PLAYER.radius + 2 + WARP_RIFT.radius;
    const reach = mouthFor(BLACK_HOLE.exitReach);
    const fallback = mouthFor(BLACK_HOLE.exitFallback);
    for (const field of FIELDS) {
      const c = CENTRE(field);
      const wide = field.width > 960;
      for (let seed = 1; seed <= 12; seed++) {
        const pairs = riftsWithHole(field, seed);
        const where = `${String(field.width)} seed ${String(seed)}`;
        if (wide) expect(pairs, where).toHaveLength(2);
        expect(pairs.length, where).toBeGreaterThanOrEqual(1);
        for (const pair of pairs)
          for (const [x, y] of [[pair.x, pair.y], [pair.toX, pair.toY]] as const) {
            const d = Math.hypot(x - c.x, y - c.y);
            if (wide) expect(d, where).toBeGreaterThanOrEqual(reach);
            else expect(d, where).toBeGreaterThanOrEqual(fallback);
          }
      }
    }
  }, 60_000);
});
