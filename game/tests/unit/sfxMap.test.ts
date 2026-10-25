import { describe, expect, it } from 'vitest';
import { sfxFor } from '../../src/audio/sfx';
import type { AsteroidSize } from '../../src/sim/asteroid';
import type { SimEvent } from '../../src/sim/events';

const destroyed = (size: AsteroidSize): SimEvent => ({ type: 'asteroidDestroyed', id: 1, x: 0, y: 0, size, points: 20 });

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

  it('maps a ship hit and game over to their own sounds', () => {
    expect(sfxFor({ type: 'shipHit', x: 0, y: 0, livesLeft: 1 })).toBe('shipHit');
    expect(sfxFor({ type: 'gameOver', score: 10 })).toBe('gameOver');
  });
});
