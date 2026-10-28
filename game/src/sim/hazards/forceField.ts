import { HAZARD_RULES, WELL_SPEED_CAP } from '../../content/hazards';
import type { GalaxyEvent, WellKind } from '../../content/types';
import type { Field } from '../field';
import type { Rng } from '../rng';
import { stormLayout } from './gravityStorm';
import type { Hazard, HazardSetup, HazardState, PointHazardState } from './hazard';
import { pullBodies, type PulledBodies } from './pull';
import { HazardSchedule, ScheduledHazard } from './schedule';

/** Where, inside the field, a force field may be drawn, as shares of its width and height: clear of the edges, so it is felt. */
const PLACE_BAND = [0.25, 0.75] as const;

/** A well as its event's warning places it: its centre, and the intensity it pulls with. */
export type WellSpot = Readonly<{ x: number; y: number; intensity: GalaxyEvent['intensity'] }>;

/** Where an event's wells sit, rolled from the hazard's stream as its warning comes; a crowded field may leave room for fewer. */
export type WellLayout = (event: GalaxyEvent, field: Field) => readonly WellSpot[];

/** A force field's one well, somewhere in the middle band of the field, at the event's intensity. */
const inBand =
  (rng: Rng): WellLayout =>
  (event, field) => [{ x: field.width * rng.range(PLACE_BAND[0], PLACE_BAND[1]), y: field.height * rng.range(PLACE_BAND[0], PLACE_BAND[1]), intensity: event.intensity }];

interface Current extends PointHazardState {
  stage: HazardState['stage'];
  x: number;
  y: number;
  remaining: number;
}

/**
 * A galaxy's gravity wells (sign +1), repulsion fields (sign -1) or gravity storms, in order: drawn as a warning for their
 * telegraph, then pulling (or pushing) for their length. A force field shows one well in the field's middle band; a storm
 * shows a set of gravity wells of intensity 1 (`stormLayout`), marked as its own, which warn, open and end together. The
 * force is an external nudge to the velocity of the rocks and the foes it pulls, each well's own; the ship's is
 * `shipPullAt`'s, summed with every other hazard's and capped. It never touches `stepShip`, whose arithmetic the parity
 * traces pin.
 */
export class ForceField extends ScheduledHazard<Current> implements Hazard {
  /** The schedule, holding the wells of the event warning or active, if any. */
  protected readonly schedule: HazardSchedule<Current>;

  constructor(kind: WellKind, setup: HazardSetup) {
    super();
    const { events, rng, nextId } = setup;
    // A storm's wells are gravity wells, marked as the storm's.
    const storm = kind === 'gravityStorm';
    const type = storm ? 'gravityWell' : kind;
    const mark = storm ? ({ storm: true } as const) : {};
    const layout = storm ? stormLayout(setup) : inBand(rng);
    this.schedule = new HazardSchedule<Current>(events, HAZARD_RULES[kind].telegraph, {
      // Rolls where the wells sit as the warning comes.
      warn: (event, elapsed, field, into, out) => {
        for (const { x, y, intensity } of layout(event, field)) {
          const id = nextId();
          out.push({ type: 'wellWarning', id, kind, x, y, at: event.at });
          into.push({ id, type, stage: 'warning', x, y, intensity, remaining: event.at - elapsed, ...mark });
        }
      },
      started: (well, out) => {
        out.push({ type: 'wellStart', id: well.id, kind });
      },
      ended: (well, out) => {
        out.push({ type: 'wellEnd', id: well.id, kind });
      },
    });
  }

  /** Nudges the rocks and the foes it pulls by `dt` seconds of each active well, none past `WELL_SPEED_CAP`. */
  pull(dt: number, bodies: PulledBodies): void {
    for (const well of this.schedule.live) if (well.stage === 'active') pullBodies(well, bodies, dt, WELL_SPEED_CAP);
  }
}
