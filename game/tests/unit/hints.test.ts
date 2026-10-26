import { describe, expect, it } from 'vitest';
import { hintCopy } from '../../src/ui/hints';

describe('hintCopy', () => {
  it('names keys for keyboard players', () => {
    expect(hintCopy('keys')).toEqual({ start: 'Press Space to start', restart: 'Press R to restart' });
  });

  it('names taps for touch players', () => {
    expect(hintCopy('touch')).toEqual({ start: 'Tap to start', restart: 'Tap Restart to play again' });
  });

  it('never mentions a key to a touch player', () => {
    const { start, restart } = hintCopy('touch');
    expect(`${start} ${restart}`).not.toMatch(/\b(press|space|key)\b|\bR\b/i);
  });
});
