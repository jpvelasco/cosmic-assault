import { kindProbability, rockSpeedMultiplier, sawtooth, spawnInterval, threatBudget } from '../../content/curves';
import { tierOf } from '../../content/galaxies';
import type { GalaxyDef, RockKind } from '../../content/types';
import type { Rng } from '../rng';
import { phaseAt, pressureScale } from './pacing';

/** What a rock weighs on the budget while it is on the field; tiny fragments weigh 0.5. */
export const ROCK_COST: Readonly<Record<RockKind, number>> = { large: 4, medium: 2, small: 1 };

/** The field the budget curve is written for. */
const REFERENCE_AREA = 1280 * 720;

export interface SpawnOrder {
  readonly kind: RockKind;
  readonly speedMultiplier: number;
}

export interface DirectorContext {
  /** Seconds into the galaxy. */
  readonly elapsed: number;
  /** Cost of the rocks on the field now, ROCK_COST per rock. */
  readonly onFieldCost: number;
  /** 0.4 for 4 s after a death, else 1. */
  readonly mercy: number;
}

/** Cost units of rocks the field may hold at `elapsed` seconds into `galaxy`. */
export function fieldBudget(galaxy: GalaxyDef, elapsed: number, mercy: number, fieldArea: number): number {
  return threatBudget(tierOf(galaxy)) * sawtooth(galaxy) * pressureScale(galaxy, elapsed) * mercy * (fieldArea / REFERENCE_AREA);
}

const ROCK_KINDS = Object.keys(ROCK_COST) as RockKind[];

/** Meters spawns by a threat budget, not a timer alone: an order is only given while the field has room for it. */
export class GalaxyDirector {
  private readonly tier: number;
  private untilNext = 0;

  constructor(
    private readonly galaxy: GalaxyDef,
    private readonly rng: Rng,
    private readonly fieldArea: number,
  ) {
    if (!Number.isFinite(fieldArea) || fieldArea <= 0) {
      throw new RangeError(`fieldArea must be a positive finite number, got ${String(fieldArea)}: pass the playfield width times height`);
    }
    this.tier = tierOf(galaxy);
  }

  /** Advances `dt` seconds; returns the rock to spawn now, if any. A refused attempt is dropped, not queued. */
  step(dt: number, ctx: DirectorContext): SpawnOrder | null {
    const scale = pressureScale(this.galaxy, ctx.elapsed);
    if (scale <= 0) {
      this.untilNext = 0;
      return null;
    }
    this.untilNext += dt;
    const interval = spawnInterval(this.tier) / scale;
    if (this.untilNext < interval) return null;
    this.untilNext %= interval;

    const kind = this.pickKind(phaseAt(this.galaxy, ctx.elapsed) === 'opening');
    if (kind === null) return null;
    if (ctx.onFieldCost + ROCK_COST[kind] > fieldBudget(this.galaxy, ctx.elapsed, ctx.mercy, this.fieldArea)) return null;
    return { kind, speedMultiplier: rockSpeedMultiplier(this.tier) };
  }

  /** A weighted pick by `kindProbability`; the opening offers only the kinds that start at tier 0. */
  private pickKind(opening: boolean): RockKind | null {
    const weights = ROCK_KINDS.map((kind) => {
      const ramp = this.galaxy.kinds[kind];
      return opening && ramp.from !== 0 ? 0 : kindProbability(ramp, this.tier);
    });
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return null;
    let roll = this.rng.next() * total;
    for (const [i, kind] of ROCK_KINDS.entries()) {
      roll -= weights[i] ?? 0;
      if (roll < 0) return kind;
    }
    return ROCK_KINDS.findLast((_, i) => (weights[i] ?? 0) > 0) ?? null;
  }
}
