import { dropChance } from '../../content/curves';
import { PICKUPS } from '../../content/pickups';
import type { PickupId, WeaponTier } from '../../content/types';
import { circlesOverlap } from '../collision';
import { MAX_WEAPON_TIER, PICKUP, PLAYER } from '../config';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import { TAU, TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import { rescale, wrapPosition } from '../wrap';

/** A pickup on the field: it drifts, and the ship collects it by touching it. */
export interface Pickup {
  readonly id: number;
  readonly kind: PickupId;
  x: number;
  y: number;
  /** Position before the latest step, for interpolated drawing; not wrap-adjusted. */
  px: number;
  py: number;
  readonly vx: number;
  readonly vy: number;
  /** Seconds until it expires. It blinks while this is under `PICKUP.blinkSeconds`. */
  expiresIn: number;
}

/** On the last life the Shield is this many times as likely, to give a struggling player a chance. */
const LAST_LIFE_SHIELD_WEIGHT = 3;

/** What a drop's kind depends on besides the pool. */
export interface DropContext {
  /** The ship is on its last life. */
  readonly lastLife: boolean;
  /** The ship's weapon tier: a weapon core is no use at the top one. */
  readonly weaponTier: WeaponTier;
}

function weightOf(kind: PickupId, { lastLife, weaponTier }: DropContext): number {
  if (kind === 'weaponCore' && weaponTier >= MAX_WEAPON_TIER) return 0;
  return PICKUPS[kind].weight * (lastLife && kind === 'shield' ? LAST_LIFE_SHIELD_WEIGHT : 1);
}

/**
 * One kind of `pool`, by the weights of `PICKUPS` (the Shield tripled on the last life, the weapon core dropped at max
 * tier); null if nothing in the pool can drop. It always consumes exactly one draw, so the stream does not shift with
 * the situation.
 */
export function chooseKind(pool: readonly PickupId[], rng: Rng, context: DropContext): PickupId | null {
  const draw = rng.next();
  const weights = pool.map((kind) => weightOf(kind, context));
  let roll = draw * weights.reduce((sum, weight) => sum + weight, 0);
  let last: PickupId | null = null;
  for (const [i, kind] of pool.entries()) {
    const weight = weights[i] ?? 0;
    if (weight <= 0) continue;
    last = kind;
    roll -= weight;
    if (roll < 0) break;
  }
  return last;
}

/** The pickups on a galaxy's field: what a kill drops from `pool`, and what drifts, expires or is collected. */
export class PickupField {
  /** Live; mutated in place by `step`. */
  readonly list: Pickup[] = [];
  private lastId = 0;

  /**
   * @param pool what kills here can drop
   * @param tier the galaxy's difficulty tier, which sets the drop chance
   * @param rng the 'pickups' stream
   */
  constructor(
    private readonly pool: readonly PickupId[],
    private readonly tier: number,
    private readonly rng: Rng,
  ) {}

  /**
   * A kill at (x, y): maybe drops a pickup. With the field full it draws nothing; otherwise it draws once for the
   * chance, and on a drop once more for the kind and once for the drift direction.
   */
  roll(x: number, y: number, context: DropContext, events: SimEvent[]): void {
    if (this.list.length >= PICKUP.maxOnField || !this.rng.chance(dropChance(this.tier))) return;
    const kind = chooseKind(this.pool, this.rng, context);
    if (kind === null) return;
    const heading = this.rng.range(0, TAU);
    const pickup: Pickup = {
      id: ++this.lastId,
      kind,
      x,
      y,
      px: x,
      py: y,
      vx: Math.cos(heading) * PICKUP.drift,
      vy: Math.sin(heading) * PICKUP.drift,
      expiresIn: PICKUP.lifespan,
    };
    this.list.push(pickup);
    events.push({ type: 'pickupDropped', id: pickup.id, kind, x, y });
  }

  /** Moves and ages every pickup; the ship at `ship` collects those it touches (`collect` gets each kind), and the old ones expire. */
  step(dt: number, field: Field, ship: { readonly x: number; readonly y: number }, collect: (kind: PickupId) => void, events: SimEvent[]): void {
    let kept = 0;
    for (const p of this.list) {
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      wrapPosition(p, field);
      p.expiresIn -= dt;
      if (circlesOverlap(p.x, p.y, PICKUP.radius, ship.x, ship.y, PLAYER.radius)) {
        events.push({ type: 'pickupCollected', id: p.id, kind: p.kind });
        collect(p.kind);
      } else if (p.expiresIn <= TIME_EPSILON) {
        events.push({ type: 'pickupExpired', id: p.id });
      } else {
        this.list[kept++] = p;
      }
    }
    this.list.length = kept;
  }

  /** Expires every pickup on the field at once, reporting each, as the warp starts. */
  expireAll(events: SimEvent[]): void {
    for (const p of this.list) events.push({ type: 'pickupExpired', id: p.id });
    this.list.length = 0;
  }

  /** Stretches every pickup's place to the new field, like the World's other entities. */
  resize(old: Field, field: Field): void {
    for (const p of this.list) {
      p.x = rescale(p.x, old.width, field.width);
      p.y = rescale(p.y, old.height, field.height);
      p.px = rescale(p.px, old.width, field.width);
      p.py = rescale(p.py, old.height, field.height);
    }
  }
}
