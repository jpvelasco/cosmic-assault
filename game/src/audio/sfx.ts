import type { Screen } from '../app/flow';
import type { FoeKind, WellKind } from '../content/types';
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
  'stormSting',
  'deflect',
  'partCrack',
  'partBreak',
  'coreExposed',
  'coreShielded',
  'hangarOpen',
  'hangarClose',
  'windupTick',
  'bolt',
  'mineArm',
  'mineBlast',
  'zoneWarn',
  'gunshipDown',
  'mineDown',
  'bossBolt',
  'phaserWarn',
  'phaserBlink',
  'riftWarn',
  'riftOpen',
  'riftJump',
  'riftClose',
  'repulseWarn',
  'repulseOpen',
  'repulseClose',
  'blast',
  'armourDeflect',
  'holeWarn',
  'holeOpen',
  'holeClose',
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

/**
 * A killed foe's death: the splitter breaks like a rock that cracks apart, a drone goes down with a zap, a gunship with a
 * heavier one, a mine with a pop, a phaser with a zap and an armoured rock like a splitter.
 */
const DEATH_BY_FOE = { splitter: 'splitterBreak', drone: 'droneDown', gunship: 'gunshipDown', mine: 'mineDown', phaser: 'droneDown', armoured: 'splitterBreak' } as const satisfies Readonly<Record<FoeKind, SfxName>>;
/**
 * A drone group arrives with a buzz; the others arrive unheard, a gunship's windup, a mine's ring and a phaser's warning
 * being their warnings.
 */
const ARRIVAL_BY_FOE = { splitter: null, drone: 'droneSwarm', gunship: null, mine: null, phaser: null, armoured: null } as const satisfies Readonly<Record<FoeKind, SfxName | null>>;

/**
 * The most times a sound starts in one frame; the rest are dropped. Held fire plus a hit-stop catch-up would stack shot
 * blips, and a drone group arrives in one step, three to five at once, which is heard as one swarm. A spread volley
 * glancing off a shielded core is heard as one tick. Foes' bolts are heard two at a time, and a boss's volley of bolts, a
 * dozen at once, as one zap. A gravity storm's wells warn, open and end in one step, each heard once.
 */
export const PER_FRAME_CAPS: Readonly<Partial<Record<SfxName, number>>> = { shoot: 3, droneSwarm: 1, deflect: 1, armourDeflect: 1, bolt: 2, bossBolt: 1, stormSting: 1, wellOpen: 1, wellClose: 1 };

/** Whether a step's events include a boss going down, which holds back that step's warp sounds. */
export function isBossKill(events: readonly SimEvent[]): boolean {
  return events.some((event) => event.type === 'bossDown');
}

/**
 * Each well's warning, start and end sounds, and whether it hums while it is active: a gravity well hums, a repulsion
 * field has its own sounds and no hum, and a gravity storm's wells warn with one sting and otherwise sound like wells.
 */
const FORCE_SOUNDS: Readonly<Record<WellKind, { readonly warn: SfxName; readonly open: SfxName; readonly close: SfxName; readonly hum: boolean }>> = {
  gravityWell: { warn: 'wellWarn', open: 'wellOpen', close: 'wellClose', hum: true },
  repulsionField: { warn: 'repulseWarn', open: 'repulseOpen', close: 'repulseClose', hum: false },
  gravityStorm: { warn: 'stormSting', open: 'wellOpen', close: 'wellClose', hum: true },
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
      return FORCE_SOUNDS[event.kind].warn;
    case 'wellStart':
      return FORCE_SOUNDS[event.kind].open;
    case 'wellEnd':
      return FORCE_SOUNDS[event.kind].close;
    // The black hole's own sounds: its warning, its opening and its close; it hums while it is active (see `humFor`).
    case 'holeWarning':
      return 'holeWarn';
    case 'holeStart':
      return 'holeOpen';
    case 'holeEnd':
      return 'holeClose';
    case 'foeDeflected':
      return 'armourDeflect';
    case 'phaserWarn':
      return 'phaserWarn';
    case 'phaserBlink':
      return 'phaserBlink';
    case 'riftWarning':
      return 'riftWarn';
    case 'riftOpen':
      return 'riftOpen';
    case 'riftClose':
      return 'riftClose';
    // Only a body that is the ship is heard: a rock or foe passing through a rift is silent.
    case 'riftJump':
      return event.ship ? 'riftJump' : null;
    case 'blast':
      return 'blast';
    case 'foeWindup':
      return 'windupTick';
    // Each source of bolt has its own voice: a foe's zaps, a boss's (a dozen at once in a volley) zaps more quietly.
    case 'boltFired':
      return event.source === 'boss' ? 'bossBolt' : 'bolt';
    case 'mineArmed':
      return 'mineArm';
    case 'mineBlast':
      return 'mineBlast';
    // A zone also hums while it is lethal: see `humFor`.
    case 'zoneWarning':
      return 'zoneWarn';
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
    // cued by its results card (`screenCue`). A zone's start and end are heard as its hum.
    case 'zoneStart':
    case 'zoneEnd':
    case 'asteroidLeft':
    case 'showerEnd':
    case 'galaxyCleared':
      return null;
  }
}

/** The looped hums: a gravity well's while it pulls, a danger zone's while it is lethal, a black hole's while it is active. */
export const HUM_NAMES = ['well', 'zone', 'hole'] as const;
export type HumName = (typeof HUM_NAMES)[number];

/**
 * How an event changes the hums: the hazard `holder` starts or stops holding one, or every one falls silent. A hum plays
 * while any hazard holds it.
 */
export type HumChange = Readonly<{ hum: HumName; on: boolean; holder: number }> | 'silence';

/**
 * How `event` changes the looped hums, or null to leave them be. A well holds the well's hum from its `wellStart` to its
 * `wellEnd`, a zone the zone's from `zoneStart` to `zoneEnd` and a hole the hole's from `holeStart` to `holeEnd`, each by
 * its own id, so one ending never cuts another still running. A galaxy that ends with one on (warp or game over) ends it
 * with no end event, so those silence every hum, as does a new galaxy starting.
 */
export function humFor(event: SimEvent): HumChange | null {
  switch (event.type) {
    // Only a force field whose sounds hum holds the well's hum: a repulsion field leaves it be.
    case 'wellStart':
    case 'wellEnd':
      return FORCE_SOUNDS[event.kind].hum ? { hum: 'well', on: event.type === 'wellStart', holder: event.id } : null;
    case 'zoneStart':
    case 'zoneEnd':
      return { hum: 'zone', on: event.type === 'zoneStart', holder: event.id };
    case 'holeStart':
    case 'holeEnd':
      return { hum: 'hole', on: event.type === 'holeStart', holder: event.id };
    case 'warpOut':
    case 'gameOver':
    case 'galaxyStart':
      return 'silence';
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
