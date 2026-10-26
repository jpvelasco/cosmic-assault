import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/app/commands';
import { GAME_OVER_GUARD_MS } from '../../src/app/gameOverGuard';
import { actsUnder, commandActs, coversFor, inputForCommand, type Cover, type RoutedInput } from '../../src/app/inputRouting';

const NO_COVER = coversFor({ settings: false, rotate: false, crash: false });

describe('coversFor', () => {
  it('is none when nothing covers the cards', () => {
    expect(NO_COVER).toEqual(['none']);
  });

  it('lists every card that is up, settings under the rotate prompt included', () => {
    expect(coversFor({ settings: true, rotate: false, crash: false })).toEqual(['settings']);
    expect(coversFor({ settings: true, rotate: true, crash: false })).toEqual(['settings', 'rotate']);
    expect(coversFor({ settings: false, rotate: true, crash: true })).toEqual(['rotate', 'crash']);
  });
});

describe('actsUnder', () => {
  // The review's matrix, row by row: which inputs act under which cover.
  it.each<[RoutedInput, none: boolean, settings: boolean, rotate: boolean, crash: boolean]>([
    ['start', true, false, false, false],
    ['resume', true, false, false, false],
    ['pause', true, false, true, false],
    ['selectLevel', true, false, true, false],
    ['toTitle', true, false, true, false],
    ['toggleMute', true, true, true, false],
    ['toggleFullscreen', true, true, true, true],
    ['navigate', true, true, false, false],
    ['pressFocused', true, true, false, false],
    ['closeSettings', true, true, false, false],
  ])('%s: none %s, settings %s, rotate %s, crash %s', (input, none, settings, rotate, crash) => {
    const under = (cover: Cover) => actsUnder(input, [cover]);
    expect([under('none'), under('settings'), under('rotate'), under('crash')]).toEqual([none, settings, rotate, crash]);
  });

  it('needs every cover that is up to allow the input', () => {
    // M acts under settings and under the rotate prompt, so it acts under both; Esc closing settings does not.
    expect(actsUnder('toggleMute', ['settings', 'rotate'])).toBe(true);
    expect(actsUnder('closeSettings', ['settings', 'rotate'])).toBe(false);
    // A level key acts under the rotate prompt alone, but not when the settings card is open beneath it.
    expect(actsUnder('selectLevel', ['settings', 'rotate'])).toBe(false);
  });
});

describe('inputForCommand', () => {
  it('splits togglePause into a pause in play and a resume otherwise', () => {
    const toggle: Command = { kind: 'togglePause' };
    expect(inputForCommand(toggle, 'playing')).toBe('pause');
    expect(inputForCommand(toggle, 'paused')).toBe('resume');
  });

  it('names every other command by its kind', () => {
    expect(inputForCommand({ kind: 'start' }, 'title')).toBe('start');
    expect(inputForCommand({ kind: 'selectLevel', level: 3 }, 'title')).toBe('selectLevel');
    expect(inputForCommand({ kind: 'toTitle' }, 'gameOver')).toBe('toTitle');
    expect(inputForCommand({ kind: 'toggleMute' }, 'playing')).toBe('toggleMute');
    expect(inputForCommand({ kind: 'toggleFullscreen' }, 'paused')).toBe('toggleFullscreen');
  });
});

describe('commandActs', () => {
  const start: Command = { kind: 'start' };

  it('runs a command the covers allow', () => {
    expect(commandActs(start, 'title', NO_COVER, 0)).toBe(true);
  });

  it('holds a command a cover blocks', () => {
    expect(commandActs(start, 'title', ['rotate'], 0)).toBe(false);
    expect(commandActs({ kind: 'togglePause' }, 'paused', ['rotate'], 0)).toBe(false);
    expect(commandActs({ kind: 'togglePause' }, 'playing', ['rotate'], 0)).toBe(true);
  });

  it('waits out the game-over guard on the game-over card', () => {
    expect(commandActs(start, 'gameOver', NO_COVER, GAME_OVER_GUARD_MS - 1)).toBe(false);
    expect(commandActs(start, 'gameOver', NO_COVER, GAME_OVER_GUARD_MS)).toBe(true);
  });
});
