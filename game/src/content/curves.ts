import type { GalaxyDef, GalaxyEvent, KindRamp } from './types';

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
  return clamp(8 + 6 * finite(t, 'tier'), 8, 40);
}

/** How much faster than base the rocks move at tier `t`; the game has tiers 0 to 5. */
export function rockSpeedMultiplier(t: number): number {
  return clamp(1 + 0.08 * finite(t, 'tier'), 1, 1.4);
}

/** The chance of picking a kind at tier `t`, before the director weighs it against the others. */
export function kindProbability(ramp: KindRamp, t: number): number {
  const { from, base, step, max } = ramp;
  for (const [name, value] of Object.entries({ from, base, step, max })) {
    if (!Number.isFinite(value)) throw new RangeError(`ramp.${name} must be a finite number, got ${String(value)}: set it to a finite number (from and step 0 or more, base and max from 0 to 1)`);
  }
  return clamp(base + Math.max(0, finite(t, 'tier') - from) * step, 0, max);
}

/** Seconds a meteor shower of `intensity` falls for, after its warning. */
export function showerSeconds(intensity: GalaxyEvent['intensity']): number {
  return Math.min(12, 6 + 3 * intensity);
}

/** Eases the first galaxy of each Dimension after the first, so a new Dimension starts gently. */
export function sawtooth(g: Pick<GalaxyDef, 'dimension' | 'index'>): number {
  return g.index === 1 && g.dimension > 1 ? 0.85 : 1;
}
