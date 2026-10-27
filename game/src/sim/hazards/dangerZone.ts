import { DANGER_ZONE, HAZARD_RULES } from '../../content/hazards';
import type { GalaxyEvent } from '../../content/types';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import type { Rng } from '../rng';
import { rescale, wrapDelta } from '../wrap';
import type { Circle, Hazard, HazardSetup, HazardState, ZoneState } from './hazard';
import { HazardSchedule } from './schedule';

/** A zone's place and size: the `w` by `h` rectangle centred on (x, y). */
export type ZoneBox = Readonly<Pick<ZoneState, 'x' | 'y' | 'w' | 'h'>>;

/**
 * The signed distance from (x, y) to `zone`, measured across the wrap as everything else is: how far outside it the
 * point is, or minus how far inside its nearest edge. The one measure of a zone: the sim strikes the ship by it, the
 * zones keep out by it, and the expert keeps clear by it.
 */
export function zoneClearance(field: Field, zone: ZoneBox, x: number, y: number): number {
  const dx = Math.abs(wrapDelta(x - zone.x, field.width)) - zone.w / 2;
  const dy = Math.abs(wrapDelta(y - zone.y, field.height)) - zone.h / 2;
  return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
}

/** Random places a zone tries before it gives up on that zone and the event shows one fewer. */
const TRIES = 32;

interface Zone extends ZoneState {
  stage: HazardState['stage'];
  x: number;
  y: number;
  remaining: number;
}

/** Whether two zones overlap. */
const overlap = (a: ZoneBox, b: ZoneBox): boolean => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/**
 * A galaxy's danger zones, an event at a time: each shows one zone per intensity (at most two), rectangles 120 to 220
 * a side, drawn as a warning for 2 s and lethal to touch for 10 s. The Shield absorbs a hit from one, as from anything.
 * They are placed inside the field, clear of each other and of every keep-out as they warn (the field's centre, any
 * respawn point and the ship), from their own stream.
 */
export class DangerZones implements Hazard {
  private readonly rng: Rng;
  private readonly nextId: () => number;
  private readonly keepOuts: (field: Field) => readonly Circle[];
  /** The schedule, holding the zones warning or active: none, one or two. */
  private readonly schedule: HazardSchedule<Zone>;
  /** The field the zones lie in, as of the last step or resize; null before the first step. */
  private field: Field | null = null;

  constructor({ events, rng, nextId, keepOuts }: HazardSetup) {
    this.rng = rng;
    this.nextId = nextId;
    this.keepOuts = keepOuts;
    this.schedule = new HazardSchedule<Zone>(events, HAZARD_RULES.dangerZone.telegraph, {
      warn: (event, elapsed, field, into, out) => {
        this.warn(event, elapsed, field, into, out);
      },
      started: (zone, out) => {
        out.push({ type: 'zoneStart', id: zone.id });
      },
      ended: (zone, out) => {
        out.push({ type: 'zoneEnd', id: zone.id });
      },
    });
  }

  get states(): readonly HazardState[] {
    return this.schedule.live;
  }

  step(elapsed: number, field: Field, out: SimEvent[]): void {
    this.field = field;
    this.schedule.step(elapsed, field, out);
  }

  /** True when a ship of radius `r` at (x, y) touches an active zone, measured across the wrap of the field it was last stepped in. */
  strikes(x: number, y: number, r: number): boolean {
    const field = this.field;
    if (field === null) return false;
    for (const zone of this.schedule.live) if (zone.stage === 'active' && zoneClearance(field, zone, x, y) < r) return true;
    return false;
  }

  resize(old: Field, field: Field): void {
    this.field = field;
    for (const zone of this.schedule.live) {
      zone.x = rescale(zone.x, old.width, field.width);
      zone.y = rescale(zone.y, old.height, field.height);
    }
  }

  stop(): void {
    this.schedule.stop();
  }

  /** Shows the event's zones into `into`, one per intensity up to two, each where it fits. */
  private warn(event: GalaxyEvent, elapsed: number, field: Field, into: Zone[], out: SimEvent[]): void {
    const count = Math.min(event.intensity, DANGER_ZONE.maxZones);
    for (let i = 0; i < count; i++) {
      const zone = this.place(event, elapsed, field, into);
      if (zone === null) continue;
      into.push(zone);
      out.push({ type: 'zoneWarning', id: zone.id, x: zone.x, y: zone.y, w: zone.w, h: zone.h });
    }
  }

  /** A zone of random size somewhere inside the field clear of the keep-outs and of `placed`, or null if none fits in `TRIES`. */
  private place(event: GalaxyEvent, elapsed: number, field: Field, placed: readonly Zone[]): Zone | null {
    const [low, high] = DANGER_ZONE.side;
    const keepOuts = this.keepOuts(field);
    for (let i = 0; i < TRIES; i++) {
      const w = this.rng.range(low, high);
      const h = this.rng.range(low, high);
      const box = { x: this.rng.range(w / 2, field.width - w / 2), y: this.rng.range(h / 2, field.height - h / 2), w, h };
      if (keepOuts.some((c) => zoneClearance(field, box, c.x, c.y) < c.r) || placed.some((other) => overlap(box, other))) continue;
      return { id: this.nextId(), type: 'dangerZone', stage: 'warning', intensity: event.intensity, remaining: event.at - elapsed, ...box };
    }
    return null;
  }
}
