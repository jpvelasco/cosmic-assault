import { HAZARD_RULES } from './hazards';
import { galaxyIdOf, type GalaxyDef, type GalaxyEvent, type GalaxyId, type KindRamp } from './types';

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number, got ${String(value)}: pass a finite number (a tier comes from tierOf())`);
  return value;
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Seconds between spawn orders at tier `t`. */
export function spawnInterval(t: number): number {
  return clamp(2.4 * 0.82 ** finite(t, 'tier'), 0.7, 2.4);
}

/** Cost units of rocks allowed on the field at tier `t`, at the reference area 1280x720. */
export function threatBudget(t: number): number {
  return clamp(12 + 3.5 * finite(t, 'tier'), 12, 40);
}

/** How much faster than base the rocks move at tier `t`; the game has tiers 0 to 5. */
export function rockSpeedMultiplier(t: number): number {
  return clamp(1 + 0.05 * finite(t, 'tier'), 1, 1.25);
}

/** The chance of picking a kind at tier `t`, before the director weighs it against the others. */
export function kindProbability(ramp: KindRamp, t: number): number {
  const { from, base, step, max } = ramp;
  for (const [name, value] of Object.entries({ from, base, step, max })) {
    if (!Number.isFinite(value)) throw new RangeError(`ramp.${name} must be a finite number, got ${String(value)}: set it to a finite number (from and step 0 or more, base and max from 0 to 1)`);
  }
  return clamp(base + Math.max(0, finite(t, 'tier') - from) * step, 0, max);
}

/** Seconds a meteor shower is warned before its rocks fall. */
export const SHOWER_WARNING_SECONDS = 3;

/** Seconds `event` is warned before it starts: a shower's warning, or a hazard's telegraph by its rule. */
export function warningSeconds({ type }: Pick<GalaxyEvent, 'type'>): number {
  return type === 'meteorShower' ? SHOWER_WARNING_SECONDS : HAZARD_RULES[type].telegraph;
}

/** Seconds a meteor shower of `intensity` falls for, after its warning. */
export function showerSeconds(intensity: GalaxyEvent['intensity']): number {
  return Math.min(12, 6 + 3 * intensity);
}

/** Seconds `event` lasts after its warning: a shower's by its intensity, a hazard's by its rule. */
export function eventSeconds({ type, intensity }: Pick<GalaxyEvent, 'type' | 'intensity'>): number {
  return type === 'meteorShower' ? showerSeconds(intensity) : HAZARD_RULES[type].seconds;
}

/** The events of a schedule that are of `type`, in order: each hazard runs only its own. */
export function eventsOfType(events: readonly GalaxyEvent[], type: GalaxyEvent['type']): GalaxyEvent[] {
  return events.filter((event) => event.type === type);
}

/**
 * The share of its tier's budget each galaxy from Crimson Nebula on fields, on top of the first galaxy's ease. Past Ion
 * Reach the rock budget stops growing with the tier: these shares hold it near Ion Reach's, so the later Dimensions get
 * harder through their foes, hazards and bosses rather than through ever more rocks and fragments, and each galaxy's
 * casual clear rate stays on the trend line (tests/balance). A boss galaxy fields a token share: room for a rock or two
 * in its approach, so no two seeds meet its boss alike, and next to none in the fight. The first two Dimensions field
 * their whole budget.
 */
const FIELD_SHARE: Readonly<Partial<Record<GalaxyId, number>>> = {
  '3-1': 0.85, '3-2': 0.75, '3-3': 0.78, '3-4': 0.68, '3-5': 0.66, '3-6': 0.25,
  '4-1': 0.64, '4-2': 0.64, '4-3': 0.7, '4-4': 0.6, '4-5': 0.62, '4-6': 0.24,
  '5-1': 0.65, '5-2': 0.6, '5-3': 0.52, '5-4': 0.46, '5-5': 0.41, '5-6': 0.15,
};

/**
 * The share of its tier's budget a galaxy fields: its `FIELD_SHARE`, eased further in the first galaxy of each
 * Dimension, so the game and every new Dimension start gently.
 */
export function sawtooth(g: Pick<GalaxyDef, 'dimension' | 'index'>): number {
  return (g.index === 1 ? 0.85 : 1) * (FIELD_SHARE[galaxyIdOf(g.dimension, g.index)] ?? 1);
}

/** The chance a kill drops a pickup at tier `t`. */
export function dropChance(t: number): number {
  return clamp(0.06 + 0.01 * finite(t, 'tier'), 0.06, 0.12);
}
