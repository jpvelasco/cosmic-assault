import { kindProbability, rockSpeedMultiplier, sawtooth, spawnInterval, threatBudget } from '../../content/curves';
import { tierOf } from '../../content/galaxies';
import type { GalaxyDef, RockKind } from '../../content/types';
import type { AsteroidSize } from '../asteroid';
import type { Rng } from '../rng';
import { phaseAt, phasePressure, pressureScale } from './pacing';

/** What a rock weighs on the budget while it is on the field; tiny fragments weigh 0.5. */
export const ROCK_COST: Readonly<Record<RockKind, number>> = { large: 4, medium: 2, small: 1 };

/** The same weights by asteroid size: a tiny fragment weighs half a small rock, so a split never changes the cost. */
export const SIZE_COST: Readonly<Record<AsteroidSize, number>> = { 0: ROCK_COST.large, 1: ROCK_COST.medium, 2: ROCK_COST.small, 3: ROCK_COST.small / 2 };

/** The field the budget and shower curves are written for. */
export const REFERENCE_AREA = 1280 * 720;

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
  return budgetAt(galaxy, pressureScale(galaxy, elapsed), mercy, fieldArea);
}

function budgetAt(galaxy: GalaxyDef, pressure: number, mercy: number, fieldArea: number): number {
  return threatBudget(tierOf(galaxy)) * sawtooth(galaxy) * pressure * mercy * (fieldArea / REFERENCE_AREA);
}

/** Throws unless `value` is a positive finite number, naming it and what to pass. */
function assertPositive(name: string, value: number, fix: string): void {
  if (!(value > 0 && Number.isFinite(value))) throw new RangeError(`${name} must be a positive finite number, got ${String(value)}: ${fix}`);
}

/** Throws unless `fieldArea` is a usable playfield width times height. */
export function assertFieldArea(fieldArea: number): void {
  assertPositive('fieldArea', fieldArea, 'pass the playfield width times height');
}

function assertContext(dt: number, { elapsed, onFieldCost, mercy }: DirectorContext): void {
  assertPositive('dt', dt, 'step the director with the fixed simulation step');
  if (!(onFieldCost >= 0 && Number.isFinite(onFieldCost))) {
    throw new RangeError(`onFieldCost must be a finite number from 0, got ${String(onFieldCost)}: sum ROCK_COST over the rocks on the field`);
  }
  if (!(elapsed >= 0 && Number.isFinite(elapsed))) {
    throw new RangeError(`elapsed must be a finite number of seconds from 0, got ${String(elapsed)}: pass the seconds since the galaxy began`);
  }
  if (!(mercy > 0 && mercy <= 1)) {
    throw new RangeError(`mercy must be between 0 (exclusive) and 1, got ${String(mercy)}: pass 0.4 for 4 s after a death, else 1`);
  }
}

const ROCK_KINDS = Object.keys(ROCK_COST) as RockKind[];

/** Meters spawns by a threat budget, not a timer alone: an order is only given while the field has room for it. */
export class GalaxyDirector {
  private readonly tier: number;
  private untilNext = 0;
  private area: number;

  constructor(
    private readonly galaxy: GalaxyDef,
    private readonly rng: Rng,
    fieldArea: number,
  ) {
    assertFieldArea(fieldArea);
    this.area = fieldArea;
    this.tier = tierOf(galaxy);
  }

  /** The playfield width times height the budget scales with; set it when the field resizes. */
  get fieldArea(): number {
    return this.area;
  }

  set fieldArea(value: number) {
    assertFieldArea(value);
    this.area = value;
  }

  /** Advances `dt` seconds; returns the rock to spawn now, if any. A refused attempt is dropped, not queued. */
  step(dt: number, ctx: DirectorContext): SpawnOrder | null {
    assertContext(dt, ctx);
    const phase = phaseAt(this.galaxy, ctx.elapsed);
    const pressure = phasePressure(this.galaxy, phase, ctx.elapsed);
    if (pressure <= 0) {
      this.untilNext = 0;
      return null;
    }
    this.untilNext += dt;
    const interval = spawnInterval(this.tier) / pressure;
    if (this.untilNext < interval) return null;
    this.untilNext %= interval;

    const kind = this.pickKind(phase === 'opening');
    if (kind === null) return null;
    if (ctx.onFieldCost + ROCK_COST[kind] > budgetAt(this.galaxy, pressure, ctx.mercy, this.area)) return null;
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
