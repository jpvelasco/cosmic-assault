import { describe, expect, it } from 'vitest';
import { hintCopy } from '../../src/ui/hints';

describe('hintCopy', () => {
  it('names keys for keyboard players', () => {
    expect(hintCopy('keys')).toEqual({
      start: 'Press Space to start',
      restart: 'Press R to play again',
      choose: 'Arrow keys to choose, Enter to go',
      controls: 'Fly with the arrows or WASD · fire with Space, Z or X',
    });
  });

  it('names taps for touch players', () => {
    expect(hintCopy('touch')).toEqual({ start: 'Tap to start', restart: 'Tap Retry or Continue to play again', choose: 'Tap a mode', controls: '' });
  });

  it('never mentions a key to a touch player', () => {
    const { start, restart, choose, controls } = hintCopy('touch');
    expect(`${start} ${restart} ${choose} ${controls}`).not.toMatch(/\b(press|space|key)\b|\bR\b/i);
  });
});
