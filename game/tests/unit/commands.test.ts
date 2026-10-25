import { describe, expect, it } from 'vitest';
import { commandForKey } from '../../src/app/commands';
import type { AppMode } from '../../src/app/game';
import { GAME_KEY_CODES } from '../../src/input/keyboard';

const START = { kind: 'start' };
const TOGGLE_PAUSE = { kind: 'togglePause' };

describe('commandForKey', () => {
  it.each([...GAME_KEY_CODES, 'Enter'])('starts from the title on %s', (code) => {
    expect(commandForKey('title', code)).toEqual(START);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('selects practice level %i on the title instead of starting', (level) => {
    expect(commandForKey('title', `Digit${String(level)}`)).toEqual({ kind: 'selectLevel', level });
  });

  it.each(['Digit0', 'Digit8', 'Digit9', 'Numpad1', 'KeyQ', 'Escape', 'KeyR'])('ignores %s on the title', (code) => {
    expect(commandForKey('title', code)).toBeNull();
  });

  it.each<[AppMode, string]>([
    ['playing', 'Escape'],
    ['playing', 'KeyP'],
    ['paused', 'Escape'],
    ['paused', 'KeyP'],
  ])('toggles pause while %s on %s', (mode, code) => {
    expect(commandForKey(mode, code)).toEqual(TOGGLE_PAUSE);
  });

  it.each<[AppMode, string]>([
    ['playing', 'Space'],
    ['playing', 'Digit3'],
    ['playing', 'KeyR'],
    ['paused', 'Enter'],
    ['paused', 'Space'],
  ])('ignores other keys while %s (%s)', (mode, code) => {
    expect(commandForKey(mode, code)).toBeNull();
  });

  it('restarts from game over on KeyR only', () => {
    expect(commandForKey('gameOver', 'KeyR')).toEqual(START);
    for (const code of ['Space', 'Enter', 'Escape', 'KeyP', 'Digit2']) {
      expect(commandForKey('gameOver', code)).toBeNull();
    }
  });
});
