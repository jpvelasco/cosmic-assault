import { DANGER_ZONE, HAZARD_RULES } from '../../content/hazards';
import type { GalaxyEvent } from '../../content/types';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { nearestPoint } from '../math';
import type { Rng } from '../rng';
import { wrapDelta } from '../wrap';
import type { Circle, Hazard, HazardSetup, HazardState, ZoneState } from './hazard';
import { HazardSchedule, ScheduledHazard } from './schedule';

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

/** Random places a zone tries, its largest side shrinking toward the smallest as it goes, before it searches a grid. */
const TRIES = 64;
/** The step of the grid a zone searches once its random tries fail, in field units: fine enough to fit one on any field the game plays at. */
export const GRID_STEP = 10;

/** Whether two zone-shaped boxes overlap. */
export const boxesOverlap = (a: ZoneBox, b: ZoneBox): boolean => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/** The `DANGER_ZONE.keepOuts` corners of `field`, as boxes. */
export function zoneKeepOutBoxes(field: Field): ZoneBox[] {
  return DANGER_ZONE.keepOuts.map(({ corner, width: most, height, widthShare }) => {
    const width = widthShare === undefined ? most : Math.min(most, widthShare * field.width);
    return {
      x: corner.endsWith('Left') ? width / 2 : field.width - width / 2,
      y: corner.startsWith('top') ? height / 2 : field.height - height / 2,
      w: width,
      h: height,
    };
  });
}

interface Zone extends ZoneState {
  stage: HazardState['stage'];
  x: number;
  y: number;
  remaining: number;
}

/**
 * A galaxy's danger zones, an event at a time: each shows one zone per intensity (at most two), rectangles 120 to 220
 * a side, drawn as a warning for 2 s and lethal to touch for 10 s. The Shield absorbs a hit from one, as from anything.
 * They are placed inside the field, clear of each other and of every keep-out as they warn (the field's centre, the
 * spot a respawn takes with nothing in the way, and the ship), from their own stream. A resize that leaves one over a
 * corner, or out of the field, moves it to the nearest place clear of them all (`refit`).
 */
export class DangerZones extends ScheduledHazard<Zone> implements Hazard {
  private readonly rng: Rng;
  private readonly nextId: () => number;
  private readonly keepOuts: (field: Field) => readonly Circle[];
  /** The schedule, holding the zones warning or active: none, one or two. */
  protected readonly schedule: HazardSchedule<Zone>;

  constructor({ events, rng, nextId, keepOuts }: HazardSetup) {
    super();
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

  /** True when a ship of radius `r` at (x, y) touches an active zone, measured across the wrap of the field it was last stepped in. */
  strikes(x: number, y: number, r: number): boolean {
    const field = this.field;
    if (field === null) return false;
    for (const zone of this.schedule.live) if (zone.stage === 'active' && zoneClearance(field, zone, x, y) < r) return true;
    return false;
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

  /**
   * A zone somewhere inside the field clear of the keep-out circles, the HUD and thumb corners and `placed`: of random
   * size at a random spot, tried `TRIES` times with its largest side shrinking toward the smallest, else the first
   * spot on a grid where a smallest zone fits (on a crowded 4:3 field with the ship in a clear spot), else null.
   */
  private place(event: GalaxyEvent, elapsed: number, field: Field, placed: readonly Zone[]): Zone | null {
    const [low, high] = DANGER_ZONE.side;
    const clear = this.clearOf(field, placed);
    const zone = (box: ZoneBox): Zone => ({ id: this.nextId(), type: 'dangerZone', stage: 'warning', intensity: event.intensity, remaining: event.at - elapsed, ...box });
    for (let i = 0; i < TRIES; i++) {
      const top = high - ((high - low) * i) / TRIES;
      const w = this.rng.range(low, top);
      const h = this.rng.range(low, top);
      const box = { x: this.rng.range(w / 2, field.width - w / 2), y: this.rng.range(h / 2, field.height - h / 2), w, h };
      if (clear(box)) return zone(box);
    }
    for (const box of gridBoxes(field, low, low)) if (clear(box)) return zone(box);
    return null;
  }

  /** Whether a box lies clear of the keep-out circles, the HUD and thumb corners and the `placed` zones. */
  private clearOf(field: Field, placed: readonly ZoneBox[]): (box: ZoneBox) => boolean {
    const keepOuts = this.keepOuts(field);
    const corners = zoneKeepOutBoxes(field);
    return (box) => !keepOuts.some((c) => zoneClearance(field, box, c.x, c.y) < c.r) && !corners.some((c) => boxesOverlap(box, c)) && !placed.some((other) => boxesOverlap(box, other));
  }

  /**
   * After a resize: a zone the stretch left over a HUD or thumb corner or out of the field moves to the nearest spot of a
   * `GRID_STEP` grid where it lies clear of everything it is placed clear of, at its size or else at the least size. A
   * zone with nowhere to go stays. It draws nothing.
   */
  refit(field: Field): void {
    const corners = zoneKeepOutBoxes(field);
    const zones = this.schedule.live;
    for (const zone of zones) {
      const inField = zone.x >= zone.w / 2 && zone.x <= field.width - zone.w / 2 && zone.y >= zone.h / 2 && zone.y <= field.height - zone.h / 2;
      if (inField && !corners.some((c) => boxesOverlap(zone, c))) continue;
      const clear = this.clearOf(field, zones.filter((other) => other !== zone));
      const nearest = (w: number, h: number): ZoneBox | null => nearestPoint([...gridBoxes(field, w, h)].filter(clear), zone);
      const least = DANGER_ZONE.side[0];
      const box = nearest(zone.w, zone.h) ?? nearest(least, least);
      if (box !== null) Object.assign(zone, box);
    }
  }
}

/** The boxes `w` by `h` centred on a `GRID_STEP` grid that lie inside `field`, row by row from the top. */
function* gridBoxes(field: Field, w: number, h: number): Generator<ZoneBox> {
  for (let y = h / 2; y <= field.height - h / 2; y += GRID_STEP) {
    for (let x = w / 2; x <= field.width - w / 2; x += GRID_STEP) yield { x, y, w, h };
  }
}
