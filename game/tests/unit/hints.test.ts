import { describe, expect, it } from 'vitest';
import { hintCopy } from '../../src/ui/hints';

describe('hintCopy', () => {
  it('names keys for keyboard players', () => {
    expect(hintCopy('keys')).toEqual({
      start: 'Press Space to start',
      restart: 'Press R to play again',
      choose: 'Arrow keys to choose, Enter to go',
      controls: 'Fly with the arrows or WASD · fire with Space, Z or X',
      resumeKey: 'Esc',
      paused: 'Esc or P to resume',
      pauseTip: 'Pause (Esc or P)',
    });
  });

  it('names taps for touch players', () => {
    expect(hintCopy('touch')).toEqual({
      start: 'Tap to start',
      restart: 'Tap Retry or Continue to play again',
      choose: 'Tap a mode',
      controls: '',
      resumeKey: '',
      paused: '',
      pauseTip: '',
    });
  });

  it('never mentions a key to a touch player', () => {
    expect(Object.values(hintCopy('touch')).join(' ')).not.toMatch(/\b(press|space|key|esc)\b|\b[RP]\b/i);
  });
});
