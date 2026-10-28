import { isWarpClear, type SimEvent } from '../sim/events';

const SHIP_HIT_SECONDS = 0.11;
const LARGE_ASTEROID_SECONDS = 0.055;
const LARGE_ASTEROID_SIZE = 0;
/** A Nova going off: the whole field's blast, a longer freeze than a large rock's. */
const NOVA_SECONDS = 0.11;
/** A boss's core laid bare: the opening the fight turns on. */
const CORE_EXPOSED_SECONDS = 0.08;

/** How long the simulation freezes for one event, in seconds; 0 for events that do not freeze. */
export function hitStopFor(event: SimEvent): number {
  switch (event.type) {
    case 'shipHit':
      return SHIP_HIT_SECONDS;
    case 'asteroidDestroyed':
      return event.size === LARGE_ASTEROID_SIZE && !isWarpClear(event) ? LARGE_ASTEROID_SECONDS : 0;
    case 'bossExposed':
      return CORE_EXPOSED_SECONDS;
    case 'blast':
      return event.kind === 'nova' ? NOVA_SECONDS : 0;
    default:
      return 0;
  }
}

/**
 * A brief freeze of simulation stepping on big hits, for game feel. Pure app-layer timing: the
 * sim is just not stepped while frozen, so game time stops and no outcome changes.
 *
 * Per frame, pass the frame time through `consume` and step the sim with what it returns; call
 * `trigger` with the events of each step. A freeze triggered mid-frame takes effect from the next
 * frame, because the current frame's `consume` has already run.
 */
export class HitStop {
  private remaining = 0;
  private reduced = false;

  /** While true nothing freezes; turning it on drops a pending freeze at once. */
  get reducedMotion(): boolean {
    return this.reduced;
  }

  set reducedMotion(value: boolean) {
    this.reduced = value;
    if (value) this.clear();
  }

  get frozen(): boolean {
    return this.remaining > 0;
  }

  /** Starts the longest freeze among `events`; overlapping freezes do not add up. */
  trigger(events: readonly SimEvent[]): void {
    if (this.reduced) return;
    for (const event of events) {
      this.remaining = Math.max(this.remaining, hitStopFor(event));
    }
  }

  /** Spends frame time on the freeze and returns the rest of the frame, which the sim may step. */
  consume(frameSeconds: number): number {
    // Not a positive real duration (NaN, negative): hand it on untouched; the step loop discards it.
    if (!(frameSeconds > 0) || !this.frozen) return frameSeconds;
    const spent = Math.min(this.remaining, frameSeconds);
    this.remaining -= spent;
    return frameSeconds - spent;
  }

  /** Drops a pending freeze (pause, quit). */
  clear(): void {
    this.remaining = 0;
  }
}
