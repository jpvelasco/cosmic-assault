import type { SimEvent } from '../sim/events';

/** Every sound effect, in the order voices.ts defines them. */
export const SFX_NAMES = [
  'shoot',
  'boomLarge',
  'boomMedium',
  'boomSmall',
  'boomTiny',
  'shipHit',
  'gameOver',
  'uiClick',
  'pause',
  'galaxyStart',
  'showerSting',
  'warp',
  'cleared',
  'combo',
  'bossIntro',
  'bossWindup',
  'bossPhase',
  'bossDown',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/** Asteroid sizes 0 (large) to 3 (tiny) in order. */
const BOOM_BY_SIZE = ['boomLarge', 'boomMedium', 'boomSmall', 'boomTiny'] as const satisfies readonly SfxName[];

/** The sound a simulation event makes, or null for a silent one. */
export function sfxFor(event: SimEvent): SfxName | null {
  switch (event.type) {
    case 'shot':
      return 'shoot';
    case 'asteroidDestroyed':
      return BOOM_BY_SIZE[event.size];
    case 'bossHit':
      return 'boomTiny';
    case 'shipHit':
      return 'shipHit';
    case 'gameOver':
      return 'gameOver';
    case 'galaxyStart':
      return 'galaxyStart';
    case 'showerWarning':
      return 'showerSting';
    case 'warpOut':
      return 'warp';
    case 'galaxyCleared':
      return 'cleared';
    // The multiplier only climbs within a chain, so above 1 it has just risen; back to 1 the chain broke, silently.
    case 'combo':
      return event.multiplier > 1 ? 'combo' : null;
    case 'bossIntro':
      return 'bossIntro';
    case 'bossWindup':
      return 'bossWindup';
    case 'bossPhase':
      return 'bossPhase';
    case 'bossDown':
      return 'bossDown';
    // A meteor leaving is not an event to the player; a shower's start and end are already told by its sting.
    case 'asteroidLeft':
    case 'showerStart':
    case 'showerEnd':
      return null;
  }
}
