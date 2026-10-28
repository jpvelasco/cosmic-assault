import { HAZARD_RULES, WELL_SPEED_CAP } from '../../content/hazards';
import type { ForceKind } from '../../content/types';
import type { Hazard, HazardSetup, HazardState, PointHazardState } from './hazard';
import { pullBodies, type PulledBodies } from './pull';
import { HazardSchedule, ScheduledHazard } from './schedule';

/** Where, inside the field, a force field may be drawn, as shares of its width and height: clear of the edges, so it is felt. */
const PLACE_BAND = [0.25, 0.75] as const;

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
export class ForceField extends ScheduledHazard<Current> implements Hazard {
  /** The schedule, holding the warning or active field, if any: a list of zero or one. */
  protected readonly schedule: HazardSchedule<Current>;

  constructor(kind: ForceKind, { events, rng, nextId }: HazardSetup) {
    super();
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

  /** Nudges the rocks and the foes it pulls by `dt` seconds of the active field, none past `WELL_SPEED_CAP`. */
  pull(dt: number, bodies: PulledBodies): void {
    const well = this.schedule.live[0];
    if (well?.stage === 'active') pullBodies(well, bodies, dt, WELL_SPEED_CAP);
  }
}
