import { DEFAULT_LOOK, SKIN_IDS, SKINS, TRAIL_IDS, TRAILS, type Look, type SkinId, type TrailId } from '../content/cosmetics';
import { DIMENSION_NUMBERS } from '../content/galaxies';
import { dimensionStars } from './progress';
import type { SaveData } from './save';

/** Stars won across Dimensions 1–5, out of 90. */
export function totalStars(save: SaveData): number {
  return DIMENSION_NUMBERS.reduce((sum, d) => sum + dimensionStars(save, d), 0);
}

/** The skins and trails within reach of `save`'s stars, in the order the Hangar lists them. */
export function unlockedLooks(save: SaveData): { readonly skins: readonly SkinId[]; readonly trails: readonly TrailId[] } {
  const stars = totalStars(save);
  return {
    skins: SKIN_IDS.filter((id) => SKINS[id].stars <= stars),
    trails: TRAIL_IDS.filter((id) => TRAILS[id].stars <= stars),
  };
}

/**
 * The look the ship draws: each chosen item where it is unlocked, else the default for that item. Nothing about the
 * unlocks is stored, so a save reset takes them away from the drawing with no other change.
 */
export function effectiveLook(chosen: Look, save: SaveData): Look {
  const { skins, trails } = unlockedLooks(save);
  return {
    skin: skins.includes(chosen.skin) ? chosen.skin : DEFAULT_LOOK.skin,
    trail: trails.includes(chosen.trail) ? chosen.trail : DEFAULT_LOOK.trail,
  };
}

/** The names of the skins and trails `after` unlocks that `before` did not, skins first: "Ember trim", "Comet trail". */
export function newlyUnlocked(before: SaveData, after: SaveData): string[] {
  const was = unlockedLooks(before);
  const now = unlockedLooks(after);
  return [
    ...now.skins.filter((id) => !was.skins.includes(id)).map((id) => `${SKINS[id].name} trim`),
    ...now.trails.filter((id) => !was.trails.includes(id)).map((id) => `${TRAILS[id].name} trail`),
  ];
}
