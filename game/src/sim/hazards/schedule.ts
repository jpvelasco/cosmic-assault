import { eventSeconds } from '../../content/curves';
import type { GalaxyEvent } from '../../content/types';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { TIME_EPSILON } from '../math';
import type { HazardState } from './hazard';

/** What the schedule keeps up to date on each hazard it runs: its stage and the seconds to its next change. */
export interface Scheduled {
  stage: HazardState['stage'];
  remaining: number;
}

/** What a hazard type does as its schedule turns. */
export interface ScheduleHooks<S extends Scheduled> {
  /** Places the hazards an event shows into `into` as its warning comes, pushing their warnings into `out`. */
  warn(event: GalaxyEvent, elapsed: number, field: Field, into: S[], out: SimEvent[]): void;
  /** Pushes the event for one of its hazards turning hostile, and for one ending. */
  started(state: S, out: SimEvent[]): void;
  ended(state: S, out: SimEvent[]): void;
}

/**
 * One hazard type's events, run one at a time: each warned for `telegraph` seconds, then hostile for its length. It
 * holds the hazards the event under way shows, and keeps their stage and countdown. The next event is warned on the
 * very step the one before it ends, so events scheduled back to back (the schedule may start the next warning as the
 * last event ends, never before) keep their whole telegraph.
 */
export class HazardSchedule<S extends Scheduled> {
  /** The hazards of the event warning or active: a live view, mutated by `step`. */
  readonly live: S[] = [];
  private nextIndex = 0;
  /** The event warning or active, or null between events. */
  private event: GalaxyEvent | null = null;
  private stage: HazardState['stage'] = 'warning';

  constructor(
    private readonly events: readonly GalaxyEvent[],
    private readonly telegraph: number,
    private readonly hooks: ScheduleHooks<S>,
  ) {}

  /** Advances to `elapsed` seconds into the galaxy, warning, starting and ending events as their times come. */
  step(elapsed: number, field: Field, out: SimEvent[]): void {
    if (this.event !== null) this.advance(this.event, elapsed, out);
    if (this.event === null) {
      const next = this.warnNext(elapsed, field, out);
      if (next !== null) this.advance(next, elapsed, out);
    }
  }

  /** Ends every event at once, without an event: the galaxy is over. */
  stop(): void {
    this.event = null;
    this.live.length = 0;
    this.nextIndex = this.events.length;
  }

  /** Warns of the next event once its warning time comes, and returns it; null before then. */
  private warnNext(elapsed: number, field: Field, out: SimEvent[]): GalaxyEvent | null {
    const event = this.events[this.nextIndex];
    if (event === undefined || elapsed + TIME_EPSILON < event.at - this.telegraph) return null;
    this.nextIndex++;
    this.event = event;
    this.stage = 'warning';
    this.hooks.warn(event, elapsed, field, this.live, out);
    return event;
  }

  private advance(event: GalaxyEvent, elapsed: number, out: SimEvent[]): void {
    if (this.stage === 'warning' && elapsed + TIME_EPSILON >= event.at) {
      this.stage = 'active';
      for (const state of this.live) this.hooks.started(state, out);
    }
    const remaining = this.stage === 'warning' ? event.at - elapsed : event.at + eventSeconds(event) - elapsed;
    for (const state of this.live) {
      state.stage = this.stage;
      state.remaining = remaining;
    }
    if (this.stage === 'active' && remaining <= TIME_EPSILON) {
      this.event = null;
      for (const state of this.live) this.hooks.ended(state, out);
      this.live.length = 0;
    }
  }
}
