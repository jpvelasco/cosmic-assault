import { describe, expect, it } from 'vitest';
import { commandForKey, commandForPad } from '../../src/app/commands';
import type { Screen } from '../../src/app/flow';
import { GAME_KEY_CODES } from '../../src/input/keyboard';

const START = { kind: 'start' };
const TOGGLE_PAUSE = { kind: 'togglePause' };
const BACK = { kind: 'back' };
const CONFIRM = { kind: 'confirm' };
const RETRY = { kind: 'retry' };
const MENUS: readonly Screen[] = ['modeSelect', 'map', 'galaxySelect'];
const ENDS: readonly Screen[] = ['results', 'gameOver', 'rankComplete'];
const SCREENS: readonly Screen[] = ['title', ...MENUS, 'playing', 'paused', ...ENDS];

describe('commandForKey', () => {
  it.each([...GAME_KEY_CODES, 'Enter'].filter((code) => !code.startsWith('Arrow')))('plays from the title on %s', (code) => {
    expect(commandForKey('title', code)).toEqual(START);
  });

  it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])('leaves %s on the title to menu focus', (code) => {
    expect(commandForKey('title', code)).toBeNull();
  });

  it.each(['Digit1', 'Digit7', 'Numpad1', 'KeyQ', 'Escape', 'KeyR'])('ignores %s on the title: practice levels are gone', (code) => {
    expect(commandForKey('title', code)).toBeNull();
  });

  it.each(MENUS)('goes back on Escape from %s, and ignores the rest there', (screen) => {
    expect(commandForKey(screen, 'Escape')).toEqual(BACK);
    for (const code of ['Space', 'Enter', 'KeyR', 'KeyP', 'ArrowDown', 'Digit2']) expect(commandForKey(screen, code)).toBeNull();
  });

  it.each<[Screen, string]>([
    ['playing', 'Escape'],
    ['playing', 'KeyP'],
    ['paused', 'Escape'],
    ['paused', 'KeyP'],
  ])('toggles pause while %s on %s', (screen, code) => {
    expect(commandForKey(screen, code)).toEqual(TOGGLE_PAUSE);
  });

  it.each<[Screen, string]>([
    ['playing', 'Space'],
    ['playing', 'Digit3'],
    ['playing', 'KeyR'],
    ['paused', 'Enter'],
    ['paused', 'Space'],
  ])('ignores other keys while %s (%s)', (screen, code) => {
    expect(commandForKey(screen, code)).toBeNull();
  });

  it.each(ENDS)('on %s: Enter is the card first button, R plays again and Escape goes back', (screen) => {
    expect(commandForKey(screen, 'Enter')).toEqual(CONFIRM);
    expect(commandForKey(screen, 'KeyR')).toEqual(RETRY);
    expect(commandForKey(screen, 'Escape')).toEqual(BACK);
    // Space is a fire key: a player still holding or mashing it must not skip the card.
    for (const code of ['Space', 'KeyP', 'Digit2', 'ArrowUp']) expect(commandForKey(screen, code)).toBeNull();
  });
});

describe('mute key', () => {
  it.each(SCREENS)('toggles mute on KeyM on %s', (screen) => {
    expect(commandForKey(screen, 'KeyM')).toEqual({ kind: 'toggleMute' });
  });
});

describe('full screen key', () => {
  it.each(SCREENS)('is not queued as a command on %s: it must run inside the keydown handler', (screen) => {
    expect(commandForKey(screen, 'KeyF')).toBeNull();
  });
});

describe('commandForPad', () => {
  it.each<[Screen, unknown]>([
    ['title', START],
    ['modeSelect', null],
    ['map', null],
    ['galaxySelect', null],
    ['playing', null],
    ['paused', TOGGLE_PAUSE],
    ['results', CONFIRM],
    ['gameOver', CONFIRM],
    ['rankComplete', CONFIRM],
  ])('confirm with nothing focused on %s', (screen, command) => {
    expect(commandForPad(screen, 'confirm')).toEqual(command);
  });

  it.each<[Screen, unknown]>([
    ['title', null],
    ['modeSelect', BACK],
    ['map', BACK],
    ['galaxySelect', BACK],
    ['playing', null],
    ['paused', TOGGLE_PAUSE],
    ['results', BACK],
    ['gameOver', BACK],
    ['rankComplete', BACK],
  ])('back on %s', (screen, command) => {
    expect(commandForPad(screen, 'back')).toEqual(command);
  });

  it.each<[Screen, unknown]>([
    ['title', START],
    ['modeSelect', null],
    ['map', null],
    ['galaxySelect', null],
    ['playing', TOGGLE_PAUSE],
    ['paused', TOGGLE_PAUSE],
    ['results', CONFIRM],
    ['gameOver', CONFIRM],
    ['rankComplete', CONFIRM],
  ])('pause (Start) on %s', (screen, command) => {
    expect(commandForPad(screen, 'pause')).toEqual(command);
  });
});
