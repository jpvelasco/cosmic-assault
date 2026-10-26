import { describe, expect, it } from 'vitest';
import { commandForKey, commandForPad } from '../../src/app/commands';
import type { AppMode } from '../../src/app/game';
import { GAME_KEY_CODES } from '../../src/input/keyboard';

const START = { kind: 'start' };
const TOGGLE_PAUSE = { kind: 'togglePause' };

describe('commandForKey', () => {
  it.each([...GAME_KEY_CODES, 'Enter'].filter((code) => !code.startsWith('Arrow')))('starts from the title on %s', (code) => {
    expect(commandForKey('title', code)).toEqual(START);
  });

  it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])('leaves %s on the title to menu focus', (code) => {
    expect(commandForKey('title', code)).toBeNull();
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

  it('restarts from game over on KeyR and returns to the title on Escape', () => {
    expect(commandForKey('gameOver', 'KeyR')).toEqual(START);
    expect(commandForKey('gameOver', 'Escape')).toEqual({ kind: 'toTitle' });
    for (const code of ['Space', 'Enter', 'KeyP', 'Digit2']) {
      expect(commandForKey('gameOver', code)).toBeNull();
    }
  });
});

describe('mute key', () => {
  it.each<AppMode>(['title', 'playing', 'paused', 'gameOver'])('toggles mute on KeyM while %s', (mode) => {
    expect(commandForKey(mode, 'KeyM')).toEqual({ kind: 'toggleMute' });
  });
});

describe('full screen key', () => {
  it.each<AppMode>(['title', 'playing', 'paused', 'gameOver'])(
    'is not queued as a command while %s: it must run inside the keydown handler',
    (mode) => {
      expect(commandForKey(mode, 'KeyF')).toBeNull();
    },
  );
});

describe('commandForPad', () => {
  it.each<[AppMode, unknown]>([
    ['title', START],
    ['paused', TOGGLE_PAUSE],
    ['gameOver', START],
    ['playing', null],
  ])('confirm with nothing focused in %s', (mode, command) => {
    expect(commandForPad(mode, 'confirm')).toEqual(command);
  });

  it.each<[AppMode, unknown]>([
    ['title', null],
    ['playing', null],
    ['paused', TOGGLE_PAUSE],
    ['gameOver', { kind: 'toTitle' }],
  ])('back in %s', (mode, command) => {
    expect(commandForPad(mode, 'back')).toEqual(command);
  });

  it.each<[AppMode, unknown]>([
    ['title', START],
    ['playing', TOGGLE_PAUSE],
    ['paused', TOGGLE_PAUSE],
    ['gameOver', START],
  ])('pause (Start) in %s', (mode, command) => {
    expect(commandForPad(mode, 'pause')).toEqual(command);
  });
});
