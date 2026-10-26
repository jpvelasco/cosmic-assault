import type { Screen } from '../app/flow';
import type { FoeKind } from '../content/types';
import { isWarpClear, type SimEvent } from '../sim/events';

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
  'showerWhoosh',
  'warp',
  'cleared',
  'combo',
  'bossIntro',
  'bossWindup',
  'bossPhase',
  'bossDown',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/** A sound to start `delay` seconds from now on the audio clock. */
export interface SfxCue {
  readonly name: SfxName;
  readonly delay: number;
}

/** On a boss kill the boss's death plays first and the warp follows this much later, so the two never land as one blast. */
export const WARP_AFTER_BOSS_SECONDS = 0.3;
/** The clear fanfare starts this long after the results card opens: after a boss kill's warp, as the card's stars fill. */
export const FANFARE_DELAY_SECONDS = 0.6;

/** One undelayed cue per sound, made once, so mapping an event allocates nothing. */
const NOW = Object.fromEntries(SFX_NAMES.map((name) => [name, { name, delay: 0 }])) as Readonly<Record<SfxName, SfxCue>>;
const WARP_AFTER_BOSS: SfxCue = { name: 'warp', delay: WARP_AFTER_BOSS_SECONDS };
const FANFARE: SfxCue = { name: 'cleared', delay: FANFARE_DELAY_SECONDS };

/** Asteroid sizes 0 (large) to 3 (tiny) in order. */
const BOOM_BY_SIZE = ['boomLarge', 'boomMedium', 'boomSmall', 'boomTiny'] as const satisfies readonly SfxName[];

/** A killed foe booms like a rock of its weight: the splitter a medium one, a drone a small one. */
const BOOM_BY_FOE = { splitter: 'boomMedium', drone: 'boomSmall' } as const satisfies Readonly<Record<FoeKind, SfxName>>;

/** Whether a step's events include a boss going down, which holds back that step's warp sounds. */
export function isBossKill(events: readonly SimEvent[]): boolean {
  return events.some((event) => event.type === 'bossDown');
}

/** The sound an event makes, or null for a silent one; the cleared galaxy's fanfare belongs to its results card instead. */
function soundOf(event: SimEvent): SfxName | null {
  switch (event.type) {
    case 'shot':
      return 'shoot';
    // The rocks a warp clears are heard as the warp itself, not as a boom each.
    case 'asteroidDestroyed':
      return isWarpClear(event) ? null : BOOM_BY_SIZE[event.size];
    case 'bossHit':
    case 'foeHit':
      return 'boomTiny';
    // Like the rocks a warp clears, a foe cleared or rammed (0 points) is heard as the warp or the hit on the ship.
    case 'foeDestroyed':
      return event.points === 0 ? null : BOOM_BY_FOE[event.kind];
    case 'shipHit':
      return 'shipHit';
    case 'gameOver':
      return 'gameOver';
    case 'galaxyStart':
      return 'galaxyStart';
    case 'showerWarning':
      return 'showerSting';
    case 'showerStart':
      return 'showerWhoosh';
    // Wells borrow the shower's sounds until they have their own.
    case 'wellWarning':
      return 'showerSting';
    case 'wellStart':
      return 'showerWhoosh';
    case 'warpOut':
      return 'warp';
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
    // A meteor leaving is not an event to the player, and a shower ending needs no fanfare. The clear's fanfare is
    // cued by its results card (`screenCue`). Pickups are silent until their sounds are made.
    case 'asteroidLeft':
    case 'showerEnd':
    case 'wellEnd':
    case 'foeSpawned':
    case 'galaxyCleared':
    case 'pickupDropped':
    case 'pickupCollected':
    case 'pickupExpired':
    case 'effectEnded':
    case 'shieldBroken':
      return null;
  }
}

/**
 * The cue for `event`, or null for a silent one. In a step where a boss went down (`bossKill`, from `isBossKill`), the
 * warp waits `WARP_AFTER_BOSS_SECONDS`, so the boss's death is heard first.
 */
export function sfxFor(event: SimEvent, bossKill = false): SfxCue | null {
  const name = soundOf(event);
  if (name === null) return null;
  return bossKill && event.type === 'warpOut' ? WARP_AFTER_BOSS : NOW[name];
}

/** The sound a screen opens with: the clear fanfare on the results and Rank complete cards, after the warp. */
export function screenCue(screen: Screen): SfxCue | null {
  return screen === 'results' || screen === 'rankComplete' ? FANFARE : null;
}
