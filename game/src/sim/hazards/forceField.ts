import { FOES } from '../../content/foes';
import { HAZARD_RULES, WELL_MAX_ACCEL, WELL_MIN_RADIUS, WELL_SPEED_CAP, WELL_STRENGTH } from '../../content/hazards';
import type { ForceKind } from '../../content/types';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import type { Foe } from '../foes/foe';
import { nudge } from '../math';
import { rescale } from '../wrap';
import type { Hazard, HazardSetup, HazardState, PointHazardState, Pullable } from './hazard';
import { HazardSchedule } from './schedule';

/** Where, inside the field, a force field may be drawn, as shares of its width and height: clear of the edges, so it is felt. */
const PLACE_BAND = [0.25, 0.75] as const;

/**
 * Units per second squared a force field of `intensity` pulls (or pushes) a body `distance` away with:
 * `k / max(r, 60)²`, never over 140. The floor on the distance keeps it finite at the centre; the cap keeps it a pull
 * a thrusting ship (200) can beat.
 */
export function wellAcceleration(distance: number, intensity: number): number {
  const reach = Math.max(distance, WELL_MIN_RADIUS);
  return Math.min(WELL_MAX_ACCEL, (WELL_STRENGTH * intensity) / (reach * reach));
}

/**
 * The share of a body's offset (dx, dy) to a force field of `sign` and `intensity`, `distance` away, that is its
 * velocity change over `dt` (or, for the default 1, its acceleration); 0 at the centre itself.
 */
export function forceShare(sign: 1 | -1, distance: number, intensity: number, dt = 1): number {
  return distance === 0 ? 0 : (sign * wellAcceleration(distance, intensity) * dt) / distance;
}

/** What a force field nudges: the rocks, and the foes it pulls. Its pull on the ship is `shipPullAt`'s. */
interface ForceBodies {
  readonly rocks: readonly Pullable[];
  readonly foes: readonly Foe[];
}

interface Current extends PointHazardState {
  stage: HazardState['stage'];
  x: number;
  y: number;
  remaining: number;
}

/**
 * A galaxy's gravity wells (sign +1) or repulsion fields (sign -1), in order: drawn as a warning for their telegraph,
 * then pulling (or pushing) for their length. The force is an external nudge to the velocity of the rocks and the
 * foes it pulls; the ship's is `shipPullAt`'s, summed with every other hazard's and capped. It never touches
 * `stepShip`, whose arithmetic the parity traces pin.
 */
export class ForceField implements Hazard {
  /** The schedule, holding the warning or active field, if any: a list of zero or one. */
  private readonly schedule: HazardSchedule<Current>;

  constructor(
    private readonly kind: ForceKind,
    private readonly sign: 1 | -1,
    { events, rng, nextId }: HazardSetup,
  ) {
    this.schedule = new HazardSchedule<Current>(events, HAZARD_RULES[kind].telegraph, {
      // Rolls where the field sits as its warning comes.
      warn: (event, elapsed, field, into, out) => {
        const x = field.width * rng.range(PLACE_BAND[0], PLACE_BAND[1]);
        const y = field.height * rng.range(PLACE_BAND[0], PLACE_BAND[1]);
        const id = nextId();
        out.push({ type: 'wellWarning', id, kind, x, y, at: event.at });
        into.push({ id, type: kind, stage: 'warning', x, y, intensity: event.intensity, remaining: event.at - elapsed });
      },
      started: (well, out) => {
        out.push({ type: 'wellStart', id: well.id, kind });
      },
      ended: (well, out) => {
        out.push({ type: 'wellEnd', id: well.id, kind });
      },
    });
  }

  get states(): readonly HazardState[] {
    return this.schedule.live;
  }

  step(elapsed: number, field: Field, out: SimEvent[]): void {
    this.schedule.step(elapsed, field, out);
  }

  /** Nudges the rocks and the foes it pulls by `dt` seconds of the active field. */
  pull(dt: number, { rocks, foes }: ForceBodies): void {
    const well = this.schedule.live[0];
    if (well?.stage !== 'active') return;
    for (const rock of rocks) this.pullBody(well, rock, dt);
    for (const foe of foes) if (FOES[foe.kind].pulled) this.pullBody(well, foe, dt);
  }

  resize(old: Field, field: Field): void {
    for (const well of this.schedule.live) {
      well.x = rescale(well.x, old.width, field.width);
      well.y = rescale(well.y, old.height, field.height);
    }
  }

  stop(): void {
    this.schedule.stop();
  }

  /** Speeds `body` toward (or away from) the field, but not past `WELL_SPEED_CAP` (a body already faster is only kept from gaining). */
  private pullBody(well: Current, body: Pullable, dt: number): void {
    const dx = well.x - body.x;
    const dy = well.y - body.y;
    const push = forceShare(this.sign, Math.hypot(dx, dy), well.intensity, dt);
    if (push !== 0) nudge(body, dx * push, dy * push, WELL_SPEED_CAP);
  }
}
