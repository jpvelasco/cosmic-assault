/**
 * How much larger than their field size sprites and effects are drawn. Hitboxes and the playfield
 * never change; only the art grows, so small screens keep the ship and shots readable.
 */
export interface VisualScale {
  readonly ship: number;
  readonly rock: number;
  readonly shot: number;
  readonly effect: number;
}

/** CSS px per field unit at which sprites are drawn at their field size. */
const REFERENCE_CSS_PER_UNIT = 0.85;
const MAX_VISUAL = 1.4;
/** Rocks grow by this share of the ship's growth, so a drawn rock edge stays close to its hitbox. */
const ROCK_SHARE = 0.5;

export const UNIT_VISUAL: VisualScale = { ship: 1, rock: 1, shot: 1, effect: 1 };

/** The scale for a layout of `cssPerUnit` CSS px per field unit; 1 across the board for NaN and values at or below 0. */
export function visualScaleFor(cssPerUnit: number): VisualScale {
  if (!(cssPerUnit > 0)) return UNIT_VISUAL;
  const v = Math.min(MAX_VISUAL, Math.max(1, REFERENCE_CSS_PER_UNIT / cssPerUnit));
  return { ship: v, rock: 1 + (v - 1) * ROCK_SHARE, shot: v, effect: v };
}
