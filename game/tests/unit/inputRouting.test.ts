import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/app/commands';
import { GAME_OVER_GUARD_MS } from '../../src/app/gameOverGuard';
import { actsUnder, commandActs, coversFor, inputForCommand, type Cover, type RoutedInput } from '../../src/app/inputRouting';

const UNCOVERED = { settings: false, records: false, hangar: false, rotate: false, crash: false };
const NO_COVER = coversFor(UNCOVERED);

describe('coversFor', () => {
  it('is none when nothing covers the cards', () => {
    expect(NO_COVER).toEqual(['none']);
  });

  it('lists every card that is up, settings or records under the rotate prompt included', () => {
    expect(coversFor({ ...UNCOVERED, settings: true })).toEqual(['settings']);
    expect(coversFor({ ...UNCOVERED, settings: true, rotate: true })).toEqual(['settings', 'rotate']);
    expect(coversFor({ ...UNCOVERED, records: true, rotate: true })).toEqual(['records', 'rotate']);
    expect(coversFor({ ...UNCOVERED, hangar: true })).toEqual(['hangar']);
    expect(coversFor({ ...UNCOVERED, hangar: true, rotate: true })).toEqual(['hangar', 'rotate']);
    expect(coversFor({ ...UNCOVERED, rotate: true, crash: true })).toEqual(['rotate', 'crash']);
  });
});

describe('actsUnder', () => {
  // The review's matrix, row by row: which inputs act under which cover.
  it.each<[RoutedInput, none: boolean, settings: boolean, records: boolean, hangar: boolean, rotate: boolean, crash: boolean]>([
    ['start', true, false, false, false, false, false],
    ['resume', true, false, false, false, false, false],
    ['pause', true, false, false, false, true, false],
    ['leave', true, false, false, false, true, false],
    ['toggleMute', true, true, true, true, true, false],
    ['toggleFullscreen', true, true, true, true, true, true],
    ['navigate', true, true, true, true, false, false],
    ['pressFocused', true, true, true, true, false, false],
    ['closeCard', true, true, true, true, false, false],
  ])('%s: none %s, settings %s, records %s, hangar %s, rotate %s, crash %s', (input, none, settings, records, hangar, rotate, crash) => {
    const under = (cover: Cover) => actsUnder(input, [cover]);
    expect([under('none'), under('settings'), under('records'), under('hangar'), under('rotate'), under('crash')]).toEqual([none, settings, records, hangar, rotate, crash]);
  });

  it('needs every cover that is up to allow the input', () => {
    // M acts under settings and under the rotate prompt, so it acts under both; Esc closing settings does not.
    expect(actsUnder('toggleMute', ['settings', 'rotate'])).toBe(true);
    expect(actsUnder('closeCard', ['settings', 'rotate'])).toBe(false);
    expect(actsUnder('closeCard', ['records', 'rotate'])).toBe(false);
    expect(actsUnder('closeCard', ['hangar', 'rotate'])).toBe(false);
    // Leaving a card acts under the rotate prompt alone, but not when the settings card is open beneath it.
    expect(actsUnder('leave', ['settings', 'rotate'])).toBe(false);
  });
});

describe('inputForCommand', () => {
  it('splits togglePause into a pause in play and a resume otherwise', () => {
    const toggle: Command = { kind: 'togglePause' };
    expect(inputForCommand(toggle, 'playing')).toBe('pause');
    expect(inputForCommand(toggle, 'paused')).toBe('resume');
  });

  it.each<Command>([
    { kind: 'start' },
    { kind: 'resumeRank' },
    { kind: 'chooseMode', mode: 'rank' },
    { kind: 'openDimension', dimension: 2 },
    { kind: 'openGalaxy', id: '1-1' },
    { kind: 'confirm' },
    { kind: 'next' },
    { kind: 'retry' },
    { kind: 'continue' },
  ])('routes %j, which goes forward and may start a run, as start', (command) => {
    expect(inputForCommand(command, 'title')).toBe('start');
  });

  it.each<Command>([{ kind: 'back' }, { kind: 'map' }, { kind: 'title' }])('routes %j, which leaves a card, as leave', (command) => {
    expect(inputForCommand(command, 'gameOver')).toBe('leave');
  });

  it('names mute and full screen by their kind', () => {
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

  it('waits out the game-over guard on the end cards', () => {
    const retry: Command = { kind: 'retry' };
    for (const screen of ['results', 'gameOver', 'rankComplete'] as const) {
      expect(commandActs(retry, screen, NO_COVER, GAME_OVER_GUARD_MS - 1)).toBe(false);
      expect(commandActs(retry, screen, NO_COVER, GAME_OVER_GUARD_MS)).toBe(true);
    }
  });
});
