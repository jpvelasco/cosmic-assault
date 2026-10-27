import type { Screen } from '../app/flow';
import type { FoeKind, ForceKind } from '../content/types';
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
  'pickupDrop',
  'pickupCollect',
  'pickupExpire',
  'effectEnd',
  'shieldBreak',
  'droneSwarm',
  'foeCrack',
  'splitterBreak',
  'droneDown',
  'wellWarn',
  'wellOpen',
  'wellClose',
  'deflect',
  'partCrack',
  'partBreak',
  'coreExposed',
  'coreShielded',
  'hangarOpen',
  'hangarClose',
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

/** A killed foe's death: the splitter breaks like a rock that cracks apart, a drone goes down with a zap. */
const DEATH_BY_FOE = { splitter: 'splitterBreak', drone: 'droneDown' } as const satisfies Readonly<Record<FoeKind, SfxName>>;
/** A drone group arrives with a buzz; a splitter arrives like any rock, unheard. */
const ARRIVAL_BY_FOE = { splitter: null, drone: 'droneSwarm' } as const satisfies Readonly<Record<FoeKind, SfxName | null>>;

/**
 * The most times a sound starts in one frame; the rest are dropped. Held fire plus a hit-stop catch-up would stack shot
 * blips, and a drone group arrives in one step, three to five at once, which is heard as one swarm. A spread volley
 * glancing off a shielded core is heard as one tick.
 */
export const PER_FRAME_CAPS: Readonly<Partial<Record<SfxName, number>>> = { shoot: 3, droneSwarm: 1, deflect: 1 };

/** Whether a step's events include a boss going down, which holds back that step's warp sounds. */
export function isBossKill(events: readonly SimEvent[]): boolean {
  return events.some((event) => event.type === 'bossDown');
}

/** Each force field's warning, start and end sounds (one with sounds also hums while active); a repulsion field is silent until it has its own. */
const FORCE_SOUNDS: Readonly<Record<ForceKind, { readonly warn: SfxName; readonly open: SfxName; readonly close: SfxName } | null>> = {
  gravityWell: { warn: 'wellWarn', open: 'wellOpen', close: 'wellClose' },
  repulsionField: null,
};

/** The sound an event makes, or null for a silent one; the cleared galaxy's fanfare belongs to its results card instead. */
function soundOf(event: SimEvent): SfxName | null {
  switch (event.type) {
    case 'shot':
      return 'shoot';
    // The rocks a warp clears are heard as the warp itself, not as a boom each.
    case 'asteroidDestroyed':
      return isWarpClear(event) ? null : BOOM_BY_SIZE[event.size];
    case 'bossHit':
      return 'boomTiny';
    case 'bossDeflected':
      return 'deflect';
    case 'bossPartHit':
      return 'partCrack';
    case 'bossPartBroken':
      return 'partBreak';
    case 'bossExposed':
      return 'coreExposed';
    case 'bossShielded':
      return 'coreShielded';
    case 'hangarOpen':
      return 'hangarOpen';
    case 'hangarClose':
      return 'hangarClose';
    // Only a foe with HP to spare survives a hit: the splitter, cracking.
    case 'foeHit':
      return 'foeCrack';
    // Like the rocks a warp clears, a foe cleared or rammed (0 points) is heard as the warp or the hit on the ship.
    case 'foeDestroyed':
      return event.points === 0 ? null : DEATH_BY_FOE[event.kind];
    case 'foeSpawned':
      return ARRIVAL_BY_FOE[event.kind];
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
    // A well also hums while it pulls: see `humFor`.
    case 'wellWarning':
      return FORCE_SOUNDS[event.kind]?.warn ?? null;
    case 'wellStart':
      return FORCE_SOUNDS[event.kind]?.open ?? null;
    case 'wellEnd':
      return FORCE_SOUNDS[event.kind]?.close ?? null;
    case 'pickupDropped':
      return 'pickupDrop';
    case 'pickupCollected':
      return 'pickupCollect';
    case 'pickupExpired':
      return 'pickupExpire';
    case 'effectEnded':
      return 'effectEnd';
    case 'shieldBroken':
      return 'shieldBreak';
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
    // cued by its results card (`screenCue`). A blast is heard in the booms of what it destroys until it has a sound of its own.
    case 'blast':
    case 'asteroidLeft':
    case 'showerEnd':
    case 'galaxyCleared':
      return null;
  }
}

/**
 * Whether `event` starts (true) or stops (false) the gravity well's looped hum, or leaves it be (null). It runs from
 * `wellStart` to `wellEnd`; a galaxy that ends mid-well (warp or game over) ends it with no `wellEnd`, so those stop it
 * too, as does a new galaxy starting.
 */
export function humFor(event: SimEvent): boolean | null {
  switch (event.type) {
    // Only a force field with sounds of its own hums: a silent one leaves the hum be.
    case 'wellStart':
      return FORCE_SOUNDS[event.kind] === null ? null : true;
    case 'wellEnd':
      return FORCE_SOUNDS[event.kind] === null ? null : false;
    case 'warpOut':
    case 'gameOver':
    case 'galaxyStart':
      return false;
    default:
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
