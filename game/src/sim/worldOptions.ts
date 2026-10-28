import type { WeaponTier } from '../content/types';
import type { AsteroidSize } from './asteroid';
import { MAX_WEAPON_TIER, PLAYER } from './config';
import { isPositiveFiniteSize, type Field } from './field';
import { MIN_PRACTICE_LEVEL, type RulesOption } from './rules';
import { FRESH_MODE_NAMES, startsFresh } from './scoring';
import { createShip, type Ship } from './ship';

export interface ShipPlacement {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface AsteroidPlacement {
  readonly x: number;
  readonly y: number;
  readonly size: AsteroidSize;
  readonly angle: number;
  readonly speedMultiplier: number;
}

export interface WorldOptions {
  readonly seed: number;
  readonly field: Field;
  /** Defaults to practice level 1. */
  readonly rules?: RulesOption;
  /**
   * Integer 1–7; defaults to 1. Deprecated: a legacy alias for `rules: { kind: 'practice', level }`; pass one
   * or the other. (Not tagged `@deprecated`, which would fail lint on every existing caller and test.)
   */
  readonly practiceLevel?: number;
  /** Starting pose instead of the field centre; the ship is still invulnerable for 3 s. */
  readonly initialShip?: ShipPlacement;
  /** Replaces the 3 practice spawns at the start of the run. */
  readonly initialAsteroids?: readonly AsteroidPlacement[];
  /** Integer 1–3 in practice, 1–5 in Rank; defaults to 3. Free play and the Daily always start with 3. */
  readonly startLives?: number;
  /**
   * The weapon tier a galaxy run starts at, integer 0–3; defaults to 0. Galaxy rules only, and Free play and the
   * Daily always start at 0: Rank carries the tier from galaxy to galaxy.
   */
  readonly startTier?: WeaponTier;
}

const MIN_START_LIVES = 1;
/** Rank sets a galaxy run's lives from 1 to 5; Free play keeps the default 3. */
export const MAX_GALAXY_START_LIVES = 5;
export const UINT32_MAX = 0xffffffff;
const ASTEROID_SIZES: readonly AsteroidSize[] = [0, 1, 2, 3];

/** World seeds are unsigned 32-bit integers. */
export function isWorldSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed <= UINT32_MAX;
}

function assertSeed(seed: number): void {
  if (!isWorldSeed(seed)) {
    throw new RangeError(
      `World needs an unsigned 32-bit integer seed (got ${String(seed)}); pass e.g. hashString(text) or value >>> 0`,
    );
  }
}

/** A run starts with an integer 1–3 lives. */
export function isStartLives(lives: number): boolean {
  return livesUpTo(lives, PLAYER.startLives);
}

/** A galaxy run (Rank) starts with an integer 1–5 lives. */
export function isGalaxyStartLives(lives: number): boolean {
  return livesUpTo(lives, MAX_GALAXY_START_LIVES);
}

function livesUpTo(lives: number, max: number): boolean {
  return Number.isInteger(lives) && lives >= MIN_START_LIVES && lives <= max;
}

function assertStartLives(lives: number, max: number): void {
  if (!livesUpTo(lives, max)) {
    throw new RangeError(
      `World startLives must be an integer from ${String(MIN_START_LIVES)} to ${String(max)} (got ${String(lives)}); omit it for the default ${String(PLAYER.startLives)}`,
    );
  }
}

/** A weapon tier is an integer from 0 to 3. */
export function isWeaponTier(tier: number): tier is WeaponTier {
  return Number.isInteger(tier) && tier >= 0 && tier <= MAX_WEAPON_TIER;
}

function resolveStartTier(opts: WorldOptions, rules: RulesOption): WeaponTier {
  const tier = opts.startTier;
  if (tier === undefined) return 0;
  if (rules.kind !== 'galaxy') {
    throw new RangeError(`WorldOptions.startTier is for galaxy rules only (practice has no pickups); drop startTier, or play rules: { kind: 'galaxy', ... }`);
  }
  if (!isWeaponTier(tier)) {
    throw new RangeError(`World startTier must be an integer from 0 to ${String(MAX_WEAPON_TIER)} (got ${String(tier)}); pass the tier the Rank run carries`);
  }
  if (startsFresh(rules.mode) && tier !== 0) {
    throw new RangeError(`${FRESH_MODE_NAMES[rules.mode]} always starts at weapon tier 0 (got startTier ${String(tier)}); omit startTier, or play mode 'rank' to carry a tier`);
  }
  return tier;
}

function resolveRules(opts: WorldOptions): RulesOption {
  if (opts.rules !== undefined && opts.practiceLevel !== undefined) {
    throw new RangeError(
      "WorldOptions has both rules and practiceLevel; drop practiceLevel and pass rules: { kind: 'practice', level } instead",
    );
  }
  return opts.rules ?? { kind: 'practice', level: opts.practiceLevel ?? MIN_PRACTICE_LEVEL };
}

export function assertField(field: Field): void {
  const { width, height } = field;
  if (!isPositiveFiniteSize(width, height)) {
    throw new RangeError(
      `World needs a field with positive finite width and height (got ${String(width)}×${String(height)}); build it with fieldForViewport()`,
    );
  }
}

export function assertFinite(owner: string, values: Readonly<Record<string, number>>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `${owner}.${name} must be a finite number (got ${String(value)}); pass a real position, angle or multiplier`,
      );
    }
  }
}

export function assertAsteroidPlacement(p: AsteroidPlacement, index: number): void {
  const owner = `WorldOptions.initialAsteroids[${String(index)}]`;
  assertFinite(owner, { x: p.x, y: p.y, angle: p.angle, speedMultiplier: p.speedMultiplier });
  if (!ASTEROID_SIZES.includes(p.size)) {
    throw new RangeError(`${owner}.size must be 0, 1, 2 or 3 (got ${String(p.size)}); 0 is large, 3 is tiny`);
  }
}

/** Checks the options a World needs before it draws anything; scenario placements are checked as they are placed. */
export function resolveOptions(opts: WorldOptions): { readonly rules: RulesOption; readonly lives: number; readonly startTier: WeaponTier } {
  assertSeed(opts.seed);
  assertField(opts.field);
  const rules = resolveRules(opts);
  const lives = opts.startLives ?? PLAYER.startLives;
  if (rules.kind === 'galaxy' && startsFresh(rules.mode) && lives !== PLAYER.startLives) {
    throw new RangeError(
      `${FRESH_MODE_NAMES[rules.mode]} always starts with ${String(PLAYER.startLives)} lives (got startLives ${String(lives)}); omit startLives, or play mode 'rank' for 1 to ${String(MAX_GALAXY_START_LIVES)}`,
    );
  }
  assertStartLives(lives, rules.kind === 'galaxy' ? MAX_GALAXY_START_LIVES : PLAYER.startLives);
  return { rules, lives, startTier: resolveStartTier(opts, rules) };
}

/** The run's ship: at `placement`, or else at rest at the centre of `field`. */
export function placeShip(field: Field, placement: ShipPlacement | undefined): Ship {
  if (placement === undefined) {
    return createShip(field.width / 2, field.height / 2);
  }
  assertFinite('WorldOptions.initialShip', { x: placement.x, y: placement.y, angle: placement.angle });
  const ship = createShip(placement.x, placement.y);
  ship.angle = placement.angle;
  ship.pangle = placement.angle;
  return ship;
}
