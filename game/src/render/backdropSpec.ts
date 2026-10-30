import { galaxyOrdinal } from '../content/galaxies';
import type { Dimension, GalaxyDef } from '../content/types';
import { createRng, deriveSeed, type Rng } from '../sim/rng';
import { RENDER_SEED } from './renderSeed';

/** A sky's set-piece: each has a painter in `backdropPieces.ts`, and `none` paints nothing (practice rules). */
export type PieceId = 'ringedPlanet' | 'gasGiant' | 'moon' | 'farSun' | 'spiralSmudge' | 'station' | 'dustLane' | 'cometTail' | 'eclipse' | 'none';

export type NonBossPieceId = Exclude<PieceId, 'eclipse' | 'none'>;

/** Vertical placement slots on each side of the field. */
export const PIECE_SLOTS = 4;

export interface BackdropSpec {
  /** Seeds the sky's geometry, its dust and its stars. */
  readonly seed: number;
  readonly piece: PieceId;
  /** True for a Dimension's boss galaxy, whose piece the painter draws at boss scale. */
  readonly boss: boolean;
  /** The side of the field the piece sits on. */
  readonly side: 'left' | 'right';
  /**
   * The row the piece is centred on, from 0 (highest) to `PIECE_SLOTS - 1` (lowest): the painter cuts the side band
   * (y 0.2 to 0.85 of the height) into `PIECE_SLOTS` equal rows and centres the piece on that row.
   */
  readonly slot: number;
}

/** The eight pieces a non-boss galaxy takes, in the order `backdropSpecFor` indexes them. */
export const NON_BOSS_PIECES: readonly NonBossPieceId[] = ['ringedPlanet', 'gasGiant', 'moon', 'farSun', 'spiralSmudge', 'station', 'dustLane', 'cometTail'];

/** Each Dimension's boss galaxy shows its own signature piece, at boss scale. */
export const BOSS_PIECES: Readonly<Record<Dimension, PieceId>> = {
  1: 'ringedPlanet',
  2: 'gasGiant',
  3: 'farSun',
  4: 'moon',
  5: 'eclipse',
};

/** The sky every run drew before 2.0.1, which practice rules (no galaxy) keep. */
export const LEGACY_SKY_SEED = deriveSeed(RENDER_SEED, 'sky');

const LEGACY_SPEC: BackdropSpec = { seed: LEGACY_SKY_SEED, piece: 'none', boss: false, side: 'left', slot: 0 };

/** Side and slot come from the spec's own stream, so they are the same every time for the same seed. */
function place(seed: number, piece: PieceId, boss: boolean, rng: Rng): BackdropSpec {
  return { seed, piece, boss, side: rng.chance(0.5) ? 'right' : 'left', slot: rng.int(0, PIECE_SLOTS) };
}

/** A Daily shares its anchor's id, so without a date seed its fallback hashes the id under a stream of its own. */
function dailySpec(galaxy: GalaxyDef, dailySeed: number | null): BackdropSpec {
  const seed = dailySeed ?? deriveSeed(RENDER_SEED, `sky|daily|${galaxy.id}`);
  const rng = createRng(seed);
  return place(seed, rng.pick(NON_BOSS_PIECES), false, rng);
}

/** The sky a galaxy is drawn with. Pure: the same galaxy (and Daily seed) always gives the same spec. */
export function backdropSpecFor(galaxy: GalaxyDef | null, dailySeed: number | null): BackdropSpec {
  if (galaxy === null) return LEGACY_SPEC;
  if (galaxy.label !== undefined) return dailySpec(galaxy, dailySeed);
  const seed = deriveSeed(RENDER_SEED, `sky|${galaxy.id}`);
  const rng = createRng(seed);
  if (galaxy.kind === 'boss') return place(seed, BOSS_PIECES[galaxy.dimension], true, rng);
  const piece = NON_BOSS_PIECES[(galaxyOrdinal(galaxy.id) * 3 + galaxy.dimension) % NON_BOSS_PIECES.length] as NonBossPieceId;
  return place(seed, piece, false, rng);
}

/** Whether `spec` is a sky drawn exactly as before 2.0.1: the practice rules' legacy sky, which is never varied. */
export function isLegacySky(spec: BackdropSpec): boolean {
  return spec.piece === 'none' || spec.seed === LEGACY_SKY_SEED;
}

/** Whether two specs bake the same sky. Each galaxy's seed is its own, so the seed and piece identify the sky. */
export function sameSky(a: BackdropSpec, b: BackdropSpec): boolean {
  return a.seed === b.seed && a.piece === b.piece;
}
