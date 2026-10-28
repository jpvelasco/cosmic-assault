import type { BossPart } from '../../sim/boss/behaviour';
import type { SimEvent } from '../../sim/events';
import { HIT_FLASH_SECONDS } from '../hitFlash';
import { easeOut } from '../scene';

/** Grows `list` to `length` with `fill`, or cuts it down, so it has one slot per part. */
function fit(list: number[], length: number, fill: number): void {
  while (list.length < length) list.push(fill);
  list.length = length;
}

/**
 * Each boss part's clocks, for a drawer: its hit flash, white for `HIT_FLASH_SECONDS` after a `bossPartHit`, and its
 * growth, from nothing to full size over `growSeconds` each time it grows back. Parts live at the start of a fight show
 * at full size.
 */
export class PartClocks {
  private readonly flash: number[] = [];
  private readonly growth: number[] = [];
  /** Whether each part was live last frame, 1 or 0. */
  private readonly live: number[] = [];

  constructor(private readonly growSeconds: number) {}

  /** Counts each part's flash down and its growth up, starting the growth afresh for a part that has just grown back. */
  advance(dt: number, parts: readonly Readonly<BossPart>[]): void {
    const { flash, growth, live } = this;
    const fresh = live.length !== parts.length;
    fit(flash, parts.length, 0);
    fit(growth, parts.length, this.growSeconds);
    fit(live, parts.length, 1);
    for (let i = 0; i < parts.length; i++) {
      const isLive = (parts[i]?.hp ?? 0) > 0 ? 1 : 0;
      if (isLive === 1 && live[i] === 0 && !fresh) growth[i] = 0;
      live[i] = isLive;
      growth[i] = (growth[i] ?? 0) + dt;
      flash[i] = Math.max(0, (flash[i] ?? 0) - dt);
    }
  }

  /** Starts a part's flash on a `bossPartHit`, and forgets every clock as a boss arrives. */
  handle(event: SimEvent): void {
    if (event.type === 'bossIntro') this.reset();
    else if (event.type === 'bossPartHit') {
      fit(this.flash, Math.max(this.flash.length, event.part + 1), 0);
      this.flash[event.part] = HIT_FLASH_SECONDS;
    }
  }

  /** Whether part `i` shows white for a hit. */
  flashing(i: number): boolean {
    return (this.flash[i] ?? 0) > 0;
  }

  /** How grown part `i` is, eased, 0 to 1. */
  grown(i: number): number {
    return easeOut(Math.min(1, (this.growth[i] ?? this.growSeconds) / this.growSeconds));
  }

  reset(): void {
    this.flash.length = 0;
    this.growth.length = 0;
    this.live.length = 0;
  }
}
