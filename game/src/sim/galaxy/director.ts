import { kindProbability, rockSpeedMultiplier, sawtooth, spawnInterval, threatBudget } from '../../content/curves';
import { tierOf } from '../../content/galaxies';
import { FOES, isFoeKind } from '../../content/foes';
import type { GalaxyDef, ThreatKind } from '../../content/types';
import type { AsteroidSize } from '../asteroid';
import type { Rng } from '../rng';
import { phaseAt, phasePressure, pressureScale } from './pacing';

/** What a threat weighs on the budget while it is on the field: a rock by its size, a foe by its content; tiny fragments weigh 0.5. */
export const THREAT_COST: Readonly<Record<ThreatKind, number>> = {
  large: 4,
  medium: 2,
  small: 1,
  splitter: FOES.splitter.cost,
  drone: FOES.drone.cost,
};

/** The rock weights by asteroid size: a tiny fragment weighs half a small rock, so a split never changes the cost. */
export const SIZE_COST: Readonly<Record<AsteroidSize, number>> = { 0: THREAT_COST.large, 1: THREAT_COST.medium, 2: THREAT_COST.small, 3: THREAT_COST.small / 2 };

/** The field the budget and shower curves are written for. */
export const REFERENCE_AREA = 1280 * 720;

export interface SpawnOrder {
  readonly kind: ThreatKind;
  /** How many to spawn: 1 for a rock, a group's size for a swarm. The budget was checked for all of them. */
  readonly count: number;
  readonly speedMultiplier: number;
}

export interface DirectorContext {
  /** Seconds into the galaxy. */
  readonly elapsed: number;
  /** Cost of the threats on the field now: THREAT_COST per foe or rock, SIZE_COST for a rock by its size. */
  readonly onFieldCost: number;
  /** 0.4 for 4 s after a death, else 1. */
  readonly mercy: number;
}

/** Cost units of threats the field may hold at `elapsed` seconds into `galaxy`. */
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
    throw new RangeError(`onFieldCost must be a finite number from 0, got ${String(onFieldCost)}: sum THREAT_COST over the threats on the field`);
  }
  if (!(elapsed >= 0 && Number.isFinite(elapsed))) {
    throw new RangeError(`elapsed must be a finite number of seconds from 0, got ${String(elapsed)}: pass the seconds since the galaxy began`);
  }
  if (!(mercy > 0 && mercy <= 1)) {
    throw new RangeError(`mercy must be between 0 (exclusive) and 1, got ${String(mercy)}: pass 0.4 for 4 s after a death, else 1`);
  }
}

const THREAT_KINDS = Object.keys(THREAT_COST) as ThreatKind[];

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

  /** Advances `dt` seconds; returns the threat to spawn now, if any. A refused attempt is dropped, not queued. */
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
    const count = this.groupSize(kind);
    if (ctx.onFieldCost + count * THREAT_COST[kind] > budgetAt(this.galaxy, pressure, ctx.mercy, this.area)) return null;
    return { kind, count, speedMultiplier: rockSpeedMultiplier(this.tier) };
  }

  /** A rock comes alone; a foe by its group: only a swarm, whose size varies, draws. */
  private groupSize(kind: ThreatKind): number {
    if (!isFoeKind(kind)) return 1;
    const [min, max] = FOES[kind].group;
    return min === max ? min : this.rng.int(min, max + 1);
  }

  /** A weighted pick by `kindProbability`; the opening offers only the kinds that start at tier 0. */
  private pickKind(opening: boolean): ThreatKind | null {
    const weights = THREAT_KINDS.map((kind) => {
      const ramp = this.galaxy.kinds[kind];
      return opening && ramp.from !== 0 ? 0 : kindProbability(ramp, this.tier);
    });
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return null;
    let roll = this.rng.next() * total;
    for (const [i, kind] of THREAT_KINDS.entries()) {
      roll -= weights[i] ?? 0;
      if (roll < 0) return kind;
    }
    return THREAT_KINDS.findLast((_, i) => (weights[i] ?? 0) > 0) ?? null;
  }
}
