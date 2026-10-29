import { describe, expect, it } from 'vitest';
import { hintCopy, hintVariants, inputStyle } from '../../src/ui/hints';

describe('inputStyle', () => {
  it('names keys for a keyboard and for a mouse, which sits beside one; taps for a finger; buttons for a pad', () => {
    expect(inputStyle('keys')).toBe('keys');
    expect(inputStyle('mouse')).toBe('keys');
    expect(inputStyle('touch')).toBe('touch');
    expect(inputStyle('pad')).toBe('pad');
  });
});

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
      confirmKey: 'Enter',
      retryKey: 'R',
      backKey: 'Esc',
      suspend: 'Esc suspends the run: pick it up from the title',
    });
  });

  it('names pad buttons for pad players', () => {
    expect(hintCopy('pad')).toEqual({
      start: 'Press A to start',
      restart: 'Press A to play again',
      choose: 'D-pad to choose, A to go, B back',
      controls: 'Fly with the left stick or D-pad · fire with A, RB or RT',
      resumeKey: 'Start',
      paused: 'Start or B to resume',
      pauseTip: 'Pause (Start or B)',
      confirmKey: 'A',
      retryKey: '',
      backKey: 'B',
      suspend: 'B suspends the run: pick it up from the title',
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
      confirmKey: '',
      retryKey: '',
      backKey: '',
      suspend: '',
    });
  });

  it('never mentions a key to a touch player', () => {
    expect(Object.values(hintCopy('touch')).join(' ')).not.toMatch(/\b(press|space|key|esc)\b|\b[RP]\b/i);
  });

  it('never mentions a key to a pad player', () => {
    expect(Object.values(hintCopy('pad')).join(' ')).not.toMatch(/\b(space|key|keys|esc|enter|arrows?|wasd)\b|\b[RPZX]\b/i);
  });

  it('lists a line\'s wording in every style, for the space it keeps', () => {
    expect(hintVariants((hints) => hints.start).sort()).toEqual(['Press A to start', 'Press Space to start', 'Tap to start']);
  });
});
