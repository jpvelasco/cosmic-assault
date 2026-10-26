import { describe, expect, it } from 'vitest';
import { SFX_NAMES, sfxFor } from '../../src/audio/sfx';
import type { AsteroidSize } from '../../src/sim/asteroid';
import type { SimEvent } from '../../src/sim/events';

const destroyed = (size: AsteroidSize): SimEvent => ({ type: 'asteroidDestroyed', id: 1, x: 0, y: 0, size, points: 20 });

/** One event of every type the galaxies and bosses added; the Record makes a new event type fail to compile here. */
const GALAXY_EVENTS: Readonly<Record<Exclude<SimEvent['type'], 'shot' | 'asteroidDestroyed' | 'asteroidLeft' | 'shipHit' | 'gameOver' | 'bossHit' | 'showerStart' | 'showerEnd'>, SimEvent>> = {
  galaxyStart: { type: 'galaxyStart', id: '1-1' },
  showerWarning: { type: 'showerWarning', angle: 0, at: 50 },
  warpOut: { type: 'warpOut' },
  galaxyCleared: { type: 'galaxyCleared', score: 900, deaths: 0, stars: 3, bonus: 750 },
  combo: { type: 'combo', multiplier: 2 },
  bossIntro: { type: 'bossIntro', id: 'sentinel' },
  bossWindup: { type: 'bossWindup', attack: 'shardRing', x: 0, y: 0 },
  bossPhase: { type: 'bossPhase', phase: 2 },
  bossDown: { type: 'bossDown', id: 'sentinel' },
};

describe('sfxFor', () => {
  it('maps a shot to shoot', () => {
    expect(sfxFor({ type: 'shot', x: 0, y: 0 })).toBe('shoot');
  });

  it.each<[AsteroidSize, string]>([
    [0, 'boomLarge'],
    [1, 'boomMedium'],
    [2, 'boomSmall'],
    [3, 'boomTiny'],
  ])('maps a size %i asteroid to %s', (size, name) => {
    expect(sfxFor(destroyed(size))).toBe(name);
  });

  it('maps a hit on a boss to a short boom', () => {
    expect(sfxFor({ type: 'bossHit', x: 0, y: 0, hp: 5 })).toBe('boomTiny');
  });

  it('maps a ship hit and game over to their own sounds', () => {
    expect(sfxFor({ type: 'shipHit', x: 0, y: 0, livesLeft: 1 })).toBe('shipHit');
    expect(sfxFor({ type: 'gameOver', score: 10 })).toBe('gameOver');
  });

  it('gives every galaxy and boss event a sound of its own, none shared with another event', () => {
    const names = Object.values(GALAXY_EVENTS).map(sfxFor);
    for (const name of names) expect(SFX_NAMES).toContain(name);
    expect(new Set(names).size).toBe(names.length);
    const older = (['shoot', 'boomLarge', 'boomMedium', 'boomSmall', 'boomTiny', 'shipHit', 'gameOver', 'uiClick', 'pause'] as const).filter((n) => names.includes(n));
    expect(older).toEqual([]);
  });

  it('chimes for a combo only as the multiplier rises, not when it breaks back to 1', () => {
    for (const multiplier of [2, 3, 4, 5]) expect(sfxFor({ type: 'combo', multiplier })).toBe('combo');
    expect(sfxFor({ type: 'combo', multiplier: 1 })).toBeNull();
  });

  it('keeps a meteor leaving the field, and a shower starting or ending, silent', () => {
    expect(sfxFor({ type: 'asteroidLeft', id: 4 })).toBeNull();
    expect(sfxFor({ type: 'showerStart' })).toBeNull();
    expect(sfxFor({ type: 'showerEnd' })).toBeNull();
  });
});
