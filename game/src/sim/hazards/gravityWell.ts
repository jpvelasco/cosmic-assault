import { eventSeconds, eventsOfType } from '../../content/curves';
import { FOES } from '../../content/foes';
import { WELL_MAX_ACCEL, WELL_MIN_RADIUS, WELL_SPEED_CAP, WELL_STRENGTH, WELL_TELEGRAPH_SECONDS } from '../../content/hazards';
import type { GalaxyEvent } from '../../content/types';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { nudge, TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Foe } from '../foes/foe';
import { rescale } from '../wrap';

/** A body a well can pull: anything with a place and a velocity. */
export interface Pullable {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Where, inside the field, a well may be drawn, as shares of its width and height: clear of the edges, so its pull is felt. */
const PLACE_BAND = [0.25, 0.75] as const;

/**
 * Units per second squared a well of `intensity` pulls a body `distance` away with: `k / max(r, 60)²`, never over 140.
 * The floor on the distance keeps the pull finite at the centre; the cap keeps it a pull a thrusting ship (200) can beat.
 */
export function wellAcceleration(distance: number, intensity: number): number {
  const reach = Math.max(distance, WELL_MIN_RADIUS);
  return Math.min(WELL_MAX_ACCEL, (WELL_STRENGTH * intensity) / (reach * reach));
}

export interface WellState {
  readonly id: number;
  readonly stage: 'warning' | 'active';
  readonly x: number;
  readonly y: number;
  readonly intensity: GalaxyEvent['intensity'];
  /** Seconds until it starts pulling (warning) or lets go (active). */
  readonly remaining: number;
}

interface Current {
  id: number;
  stage: WellState['stage'];
  x: number;
  y: number;
  intensity: GalaxyEvent['intensity'];
  remaining: number;
  event: GalaxyEvent;
}

/**
 * A galaxy's gravity wells, in order: drawn for 2 s as a warning, then pulling for 14 s. The pull is an external
 * nudge to the velocity of the ship, the rocks and the foes a well pulls, applied once a step by `pull`: it never
 * touches `stepShip`, whose arithmetic the parity traces pin.
 */
export class Wells {
  private readonly events: readonly GalaxyEvent[];
  private nextIndex = 0;
  private current: Current | null = null;

  /**
   * @param events the galaxy's events; the wells among them are taken, in order
   * @param rng the 'hazards' stream: where each well sits
   * @param nextId hands out an id for each well
   */
  constructor(
    events: readonly GalaxyEvent[],
    private readonly rng: Rng,
    private readonly nextId: () => number,
  ) {
    this.events = eventsOfType(events, 'gravityWell');
  }

  /** The warning or active well, or null; a live view, mutated by `step`. */
  get state(): WellState | null {
    return this.current;
  }

  /** Advances to `elapsed` seconds into the galaxy, pushing the warning, the start and the end into `out`. */
  step(elapsed: number, field: Field, out: SimEvent[]): void {
    const well = this.current ?? this.warn(elapsed, field, out);
    if (well === null) return;
    const { at } = well.event;
    if (well.stage === 'warning' && elapsed + TIME_EPSILON >= at) {
      well.stage = 'active';
      out.push({ type: 'wellStart', id: well.id });
    }
    if (well.stage === 'warning') {
      well.remaining = at - elapsed;
      return;
    }
    well.remaining = at + eventSeconds(well.event) - elapsed;
    if (well.remaining <= TIME_EPSILON) {
      this.current = null;
      out.push({ type: 'wellEnd', id: well.id });
    }
  }

  /** Nudges the velocity of `ship`, `rocks` and those of `foes` that a well pulls, by `dt` seconds of the active well's pull. */
  pull(dt: number, ship: Pullable, rocks: readonly Pullable[], foes: readonly Foe[]): void {
    const well = this.current;
    if (well?.stage !== 'active') return;
    pullBody(well, ship, dt);
    for (const rock of rocks) pullBody(well, rock, dt);
    for (const foe of foes) if (FOES[foe.kind].pulled) pullBody(well, foe, dt);
  }

  /** Stretches the well's place to the new field, like the World's other entities, so it never ends up outside it. */
  resize(old: Field, field: Field): void {
    const well = this.current;
    if (well === null) return;
    well.x = rescale(well.x, old.width, field.width);
    well.y = rescale(well.y, old.height, field.height);
  }

  /** Ends any warning or well at once, without an event: the galaxy is over. */
  stop(): void {
    this.current = null;
    this.nextIndex = this.events.length;
  }

  /** Draws the next well once its warning time comes, rolling where it sits. */
  private warn(elapsed: number, field: Field, out: SimEvent[]): Current | null {
    const event = this.events[this.nextIndex];
    if (event === undefined || elapsed + TIME_EPSILON < event.at - WELL_TELEGRAPH_SECONDS) return null;
    this.nextIndex++;
    const x = field.width * this.rng.range(PLACE_BAND[0], PLACE_BAND[1]);
    const y = field.height * this.rng.range(PLACE_BAND[0], PLACE_BAND[1]);
    out.push({ type: 'wellWarning', x, y, at: event.at });
    this.current = { id: this.nextId(), stage: 'warning', x, y, intensity: event.intensity, remaining: event.at - elapsed, event };
    return this.current;
  }
}

/** Speeds `body` toward the well, but not past `WELL_SPEED_CAP` (a body already faster is only kept from gaining). */
function pullBody(well: Current, body: Pullable, dt: number): void {
  const dx = well.x - body.x;
  const dy = well.y - body.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const push = (wellAcceleration(distance, well.intensity) * dt) / distance;
  nudge(body, dx * push, dy * push, WELL_SPEED_CAP);
}
