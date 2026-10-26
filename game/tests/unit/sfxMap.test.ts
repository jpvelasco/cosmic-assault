import { describe, expect, it } from 'vitest';
import { FANFARE_DELAY_SECONDS, isBossKill, screenCue, SFX_NAMES, sfxFor, WARP_AFTER_BOSS_SECONDS } from '../../src/audio/sfx';
import { END_SCREENS, MENU_SCREENS } from '../../src/app/flow';
import type { AsteroidSize } from '../../src/sim/asteroid';
import type { SimEvent } from '../../src/sim/events';

/** The pickup events, which have no sound yet. */
type PickupEvent = 'pickupDropped' | 'pickupCollected' | 'pickupExpired' | 'effectEnded' | 'shieldBroken';

const destroyed = (size: AsteroidSize, points = 20): SimEvent => ({ type: 'asteroidDestroyed', id: 1, x: 0, y: 0, size, points });
const nameOf = (event: SimEvent): string | null => sfxFor(event)?.name ?? null;

/** One event of every type the galaxies and bosses added that makes a sound; the Record makes a new event type fail to compile here. */
const GALAXY_EVENTS: Readonly<Record<Exclude<SimEvent['type'], 'shot' | 'asteroidDestroyed' | 'asteroidLeft' | 'shipHit' | 'gameOver' | 'bossHit' | 'showerEnd' | 'galaxyCleared' | PickupEvent>, SimEvent>> = {
  galaxyStart: { type: 'galaxyStart', id: '1-1' },
  showerWarning: { type: 'showerWarning', angle: 0, at: 50 },
  showerStart: { type: 'showerStart' },
  warpOut: { type: 'warpOut' },
  combo: { type: 'combo', multiplier: 2 },
  bossIntro: { type: 'bossIntro', id: 'sentinel' },
  bossWindup: { type: 'bossWindup', attack: 'shardRing', x: 0, y: 0 },
  bossPhase: { type: 'bossPhase', phase: 2 },
  bossDown: { type: 'bossDown', id: 'sentinel' },
};

/** The step a boss dies on: it goes down, the galaxy warps out (clearing the field for 0 points) and is cleared. */
const BOSS_KILL_STEP: readonly SimEvent[] = [
  { type: 'bossDown', id: 'sentinel' },
  { type: 'warpOut' },
  destroyed(2, 0),
  { type: 'galaxyCleared', score: 2250, deaths: 0, stars: 3, bonus: 750 },
];

describe('sfxFor', () => {
  it('maps a shot to shoot, at once', () => {
    expect(sfxFor({ type: 'shot', x: 0, y: 0 })).toEqual({ name: 'shoot', delay: 0 });
  });

  it.each<[AsteroidSize, string]>([
    [0, 'boomLarge'],
    [1, 'boomMedium'],
    [2, 'boomSmall'],
    [3, 'boomTiny'],
  ])('maps a size %i asteroid to %s', (size, name) => {
    expect(nameOf(destroyed(size))).toBe(name);
  });

  it('maps a hit on a boss to a short boom', () => {
    expect(nameOf({ type: 'bossHit', x: 0, y: 0, hp: 5 })).toBe('boomTiny');
  });

  it('maps a ship hit and game over to their own sounds', () => {
    expect(nameOf({ type: 'shipHit', x: 0, y: 0, livesLeft: 1 })).toBe('shipHit');
    expect(nameOf({ type: 'gameOver', score: 10 })).toBe('gameOver');
  });

  it('gives every galaxy and boss event a sound of its own, none shared with another event', () => {
    const names = Object.values(GALAXY_EVENTS).map(nameOf);
    for (const name of names) expect(SFX_NAMES).toContain(name);
    expect(new Set(names).size).toBe(names.length);
    const older = (['shoot', 'boomLarge', 'boomMedium', 'boomSmall', 'boomTiny', 'shipHit', 'gameOver', 'uiClick', 'pause'] as const).filter((n) => names.includes(n));
    expect(older).toEqual([]);
  });

  it('chimes for a combo only as the multiplier rises, not when it breaks back to 1', () => {
    for (const multiplier of [2, 3, 4, 5]) expect(nameOf({ type: 'combo', multiplier })).toBe('combo');
    expect(sfxFor({ type: 'combo', multiplier: 1 })).toBeNull();
  });

  it('whooshes softly as a shower starts, and keeps its end and a meteor leaving silent', () => {
    expect(nameOf({ type: 'showerStart' })).toBe('showerWhoosh');
    expect(sfxFor({ type: 'showerEnd' })).toBeNull();
    expect(sfxFor({ type: 'asteroidLeft', id: 4 })).toBeNull();
  });

  it('keeps the pickup events silent until their sounds are made', () => {
    const events: SimEvent[] = [
      { type: 'pickupDropped', id: 1, kind: 'shield', x: 0, y: 0 },
      { type: 'pickupCollected', id: 1, kind: 'shield' },
      { type: 'pickupExpired', id: 1 },
      { type: 'effectEnded', kind: 'shield' },
      { type: 'shieldBroken' },
    ];
    for (const event of events) expect(sfxFor(event)).toBeNull();
  });

  it('leaves the clear fanfare to the results card, not the sim event', () => {
    expect(sfxFor({ type: 'galaxyCleared', score: 900, deaths: 0, stars: 3, bonus: 750 })).toBeNull();
  });

  it('warps at once when the timer runs out, the rocks it clears adding no boom of their own', () => {
    const step: SimEvent[] = [{ type: 'warpOut' }, destroyed(1, 0), destroyed(0, 0), destroyed(3, 0)];
    expect(isBossKill(step)).toBe(false);
    expect(step.map((event) => sfxFor(event, isBossKill(step)))).toEqual([{ name: 'warp', delay: 0 }, null, null, null]);
  });
});

describe('a boss kill', () => {
  it('plays the boss down first, the warp 0.3 s later (its rocks silent), and the fanfare as the results card fills', () => {
    const bossKill = isBossKill(BOSS_KILL_STEP);
    expect(bossKill).toBe(true);
    const cues = BOSS_KILL_STEP.map((event) => sfxFor(event, bossKill));
    expect(cues).toEqual([{ name: 'bossDown', delay: 0 }, { name: 'warp', delay: WARP_AFTER_BOSS_SECONDS }, null, null]);
    // The card opens on this same step; its fanfare comes after the warp.
    const fanfare = screenCue('results');
    expect(fanfare).toEqual({ name: 'cleared', delay: FANFARE_DELAY_SECONDS });
    expect(WARP_AFTER_BOSS_SECONDS).toBeCloseTo(0.3);
    expect(FANFARE_DELAY_SECONDS).toBeGreaterThan(WARP_AFTER_BOSS_SECONDS);
  });

  it('keeps a kill in the same step on time: only the warp sounds wait', () => {
    expect(sfxFor(destroyed(1, 40), true)).toEqual({ name: 'boomMedium', delay: 0 });
  });
});

describe('screenCue', () => {
  it('opens results and Rank complete with the fanfare, and no other screen with a sound', () => {
    expect(screenCue('rankComplete')?.name).toBe('cleared');
    const silent = [...MENU_SCREENS, 'playing', 'paused', ...END_SCREENS.filter((s) => s === 'gameOver')] as const;
    for (const screen of silent) expect(screenCue(screen)).toBeNull();
  });
});
