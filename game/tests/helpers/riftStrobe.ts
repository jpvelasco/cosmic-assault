import type { Asteroid } from '../../src/sim/asteroid';
import { ASTEROID, PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { hazardStreams, HazardField } from '../../src/sim/hazards/hazardField';
import { createShip } from '../../src/sim/ship';
import { hazardFoes } from './foeAt';

/** Every body radius a jump can carry: the ship, a small rock, a foe, and a large rock. */
export const JUMP_RADII = [PLAYER.radius, 15, 40, ASTEROID.radii[0]];
/** The headings a body is sent along out of a mouth, evenly round. */
export const JUMP_HEADINGS = 16;
/** A quarter second in fixed steps: a body that strobes between two pairs would jump again within it. */
export const QUARTER_SECOND_STEPS = 30;
/** How long each body is carried for, in fixed steps: two seconds. */
const SWEEP_STEPS = 240;
/** When the sweep's rift event opens, and when the sweep starts, its pairs open. */
const RIFT_AT = 20;
const SWEEP_FROM = 22;

/** Each rock has its own id, since a body that has jumped rests under its id. */
let nextRockId = 1000;
/** A rock at `entry`, heading `angle` at 100 units a second, of `radius`. */
export const rockAt = (entry: Readonly<{ x: number; y: number }>, angle: number, radius: number): Asteroid =>
  ({ id: nextRockId++, x: entry.x, y: entry.y, px: entry.x, py: entry.y, vx: Math.cos(angle) * 100, vy: Math.sin(angle) * 100, radius, size: 0 }) as unknown as Asteroid;

/**
 * Carries a body of every `JUMP_RADII` along every `JUMP_HEADINGS` heading out of every mouth of the pairs that one
 * intensity-2 rift event places on `field` from `seed` (the ship tucked at (5, 5)), for two seconds each, and returns
 * for each the fewest steps between two of its jumps, Infinity for a body that jumped once or never.
 */
export function strobeGaps(seed: number, field: Field): { readonly where: string; readonly gap: number }[] {
  let id = 0;
  const ship = createShip(5, 5);
  ship.invulnerable = false;
  const hazards = new HazardField([{ at: RIFT_AT, type: 'warpRift', intensity: 2 }], hazardStreams(seed), () => ++id);
  hazards.move(0, ship, [], hazardFoes(), []);
  for (let t = STEP_SECONDS; t <= SWEEP_FROM + 1e-9; t += STEP_SECONDS) hazards.step(t, field, []);
  const entries = hazards.states.flatMap((state) => (state.type === 'warpRift' ? [{ x: state.x, y: state.y }, { x: state.toX, y: state.toY }] : []));
  const gaps: { where: string; gap: number }[] = [];
  for (const entry of entries)
    for (const radius of JUMP_RADII)
      for (let h = 0; h < JUMP_HEADINGS; h++) {
        const rock = rockAt(entry, (h * 2 * Math.PI) / JUMP_HEADINGS, radius);
        const jumpSteps: number[] = [];
        for (let step = 0; step < SWEEP_STEPS; step++) {
          const out: SimEvent[] = [];
          hazards.step(SWEEP_FROM + (step + 1) * STEP_SECONDS, field, out);
          rock.px = rock.x;
          rock.py = rock.y;
          hazards.move(STEP_SECONDS, ship, [rock], hazardFoes(), out);
          if (out.some((e) => e.type === 'riftJump' && !e.ship)) jumpSteps.push(step);
          rock.x += rock.vx * STEP_SECONDS;
          rock.y += rock.vy * STEP_SECONDS;
        }
        const between = jumpSteps.slice(1).map((step, i) => step - (jumpSteps[i] ?? 0));
        gaps.push({ where: `seed ${String(seed)} radius ${String(radius)} heading ${String(h)}`, gap: Math.min(Infinity, ...between) });
      }
  return gaps;
}
