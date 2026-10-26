import { showerSeconds } from '../../content/curves';
import type { GalaxyEvent } from '../../content/types';
import { EDGE_COUNT, type Edge } from '../asteroid';
import type { SimEvent } from '../events';
import { TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import { assertFieldArea, REFERENCE_AREA } from './director';

export const SHOWER_WARNING_SECONDS = 3;

/** Bearings from the field centre to the top, right, bottom and left edges; y grows downwards. */
export const EDGE_BEARINGS: readonly [number, number, number, number] = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

type Intensity = GalaxyEvent['intensity'];

/** The most rocks per second a shower drops: 2 + intensity at the reference area, scaled by field area. */
export function showerRate(intensity: Intensity, fieldArea: number): number {
  return ((2 + intensity) * fieldArea) / REFERENCE_AREA;
}

/** The most shower rocks on the field at once: 3 + 2 x intensity at the reference area, scaled by field area. */
export function showerCap(intensity: Intensity, fieldArea: number): number {
  return ((3 + 2 * intensity) * fieldArea) / REFERENCE_AREA;
}

export interface ShowerState {
  readonly stage: 'warning' | 'active';
  /** The edge the rocks come from. */
  readonly edge: Edge;
  /** That edge's bearing from the field centre, for the HUD warning. */
  readonly angle: number;
  /** Seconds until the shower starts (warning) or ends (active). */
  readonly remaining: number;
}

interface Current {
  stage: ShowerState['stage'];
  edge: Edge;
  angle: number;
  remaining: number;
  event: GalaxyEvent;
}

/**
 * A galaxy's meteor showers, in order: a 3 s warning from one edge, then a stream of rocks from it,
 * capped in rate and in how many are on the field at once. Rocks held back by the cap are dropped, not queued.
 */
export class Showers {
  private nextIndex = 0;
  private current: Current | null = null;
  /** Rocks earned by the rate but not yet dropped. */
  private owed = 0;

  constructor(
    private readonly events: readonly GalaxyEvent[],
    private readonly rng: Rng,
  ) {}

  /** The warning or active shower, or null; a live view, mutated by `step`. */
  get state(): ShowerState | null {
    return this.current;
  }

  /**
   * Advances to `elapsed` seconds into the galaxy, pushing warnings, starts and ends into `out`.
   * `onField` is how many of the shower's rocks are still on the field.
   * Returns how many rocks to drop from `state.edge` this step.
   */
  step(elapsed: number, dt: number, fieldArea: number, onField: number, out: SimEvent[]): number {
    assertFieldArea(fieldArea);
    const shower = this.current ?? this.warn(elapsed, out);
    if (shower === null) return 0;
    const { at, intensity } = shower.event;
    if (shower.stage === 'warning' && elapsed + TIME_EPSILON >= at) {
      shower.stage = 'active';
      this.owed = 0;
      out.push({ type: 'showerStart' });
    }
    if (shower.stage === 'warning') {
      shower.remaining = at - elapsed;
      return 0;
    }
    shower.remaining = at + showerSeconds(intensity) - elapsed;
    if (shower.remaining <= TIME_EPSILON) {
      this.current = null;
      out.push({ type: 'showerEnd' });
      return 0;
    }
    this.owed += showerRate(intensity, fieldArea) * dt;
    const due = Math.floor(this.owed + TIME_EPSILON);
    this.owed -= due;
    return Math.max(0, Math.min(due, Math.floor(showerCap(intensity, fieldArea) + TIME_EPSILON) - onField));
  }

  /** Ends any warning or shower at once, without an event: the galaxy is over. */
  stop(): void {
    this.current = null;
    this.nextIndex = this.events.length;
  }

  /** Telegraphs the next shower once its warning time comes, rolling the edge it will come from. */
  private warn(elapsed: number, out: SimEvent[]): Current | null {
    const event = this.events[this.nextIndex];
    if (event === undefined || elapsed + TIME_EPSILON < event.at - SHOWER_WARNING_SECONDS) return null;
    this.nextIndex++;
    const edge = this.rng.int(0, EDGE_COUNT) as Edge;
    const angle = EDGE_BEARINGS[edge];
    out.push({ type: 'showerWarning', angle, at: event.at });
    this.current = { stage: 'warning', edge, angle, remaining: event.at - elapsed, event };
    return this.current;
  }
}
