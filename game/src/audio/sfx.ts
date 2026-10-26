import type { SimEvent } from '../sim/events';

export type SfxName =
  | 'shoot'
  | 'boomLarge'
  | 'boomMedium'
  | 'boomSmall'
  | 'boomTiny'
  | 'shipHit'
  | 'gameOver'
  | 'uiClick'
  | 'pause';

/** Asteroid sizes 0 (large) to 3 (tiny) in order. */
const BOOM_BY_SIZE = ['boomLarge', 'boomMedium', 'boomSmall', 'boomTiny'] as const satisfies readonly SfxName[];

/** The sound a simulation event makes, or null for a silent one. */
export function sfxFor(event: SimEvent): SfxName | null {
  switch (event.type) {
    case 'shot':
      return 'shoot';
    case 'asteroidDestroyed':
      return BOOM_BY_SIZE[event.size];
    case 'shipHit':
      return 'shipHit';
    case 'gameOver':
      return 'gameOver';
    // Galaxy flow events get their sounds with the galaxy HUD.
    case 'asteroidLeft':
    case 'galaxyStart':
    case 'showerWarning':
    case 'showerStart':
    case 'showerEnd':
    case 'warpOut':
    case 'galaxyCleared':
    case 'combo':
      return null;
  }
}
