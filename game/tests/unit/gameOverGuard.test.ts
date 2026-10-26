import { describe, expect, it } from 'vitest';
import { commandForKey, CONFIRM, type Command } from '../../src/app/commands';
import type { Screen } from '../../src/app/flow';
import { GAME_OVER_GUARD_MS, passesGameOverGuard } from '../../src/app/gameOverGuard';

const ENDS: readonly Screen[] = ['results', 'gameOver', 'rankComplete'];

/** Every way to leave an end card: its keys, and the commands its buttons send. */
const END_INPUTS: readonly [string, Command | null][] = [
  ['Enter', commandForKey('results', 'Enter')],
  ['R', commandForKey('gameOver', 'KeyR')],
  ['Escape', commandForKey('gameOver', 'Escape')],
  ['pad A', CONFIRM],
  ['the Next button', { kind: 'next' }],
  ['the Retry button', { kind: 'retry' }],
  ['the Map button', { kind: 'map' }],
  ['the Continue button', { kind: 'continue' }],
  ['the Title button', { kind: 'title' }],
];

describe('passesGameOverGuard', () => {
  it('guards for 700 ms', () => {
    expect(GAME_OVER_GUARD_MS).toBe(700);
  });

  it.each(END_INPUTS)('ignores %s on every end card before 700 ms', (_input, command) => {
    if (command === null) throw new Error('every end-card input must map to a command');
    for (const screen of ENDS) {
      for (const ms of [0, 16, 350, 699.9]) expect(passesGameOverGuard(screen, command, ms)).toBe(false);
    }
  });

  it.each(END_INPUTS)('accepts %s from 700 ms on', (_input, command) => {
    if (command === null) throw new Error('every end-card input must map to a command');
    for (const screen of ENDS) {
      for (const ms of [700, 700.1, 5000]) expect(passesGameOverGuard(screen, command, ms)).toBe(true);
    }
  });

  it.each<[Screen, Command]>([
    ['title', { kind: 'start' }],
    ['modeSelect', { kind: 'back' }],
    ['playing', { kind: 'togglePause' }],
    ['paused', { kind: 'title' }],
    ['gameOver', { kind: 'toggleMute' }],
    ['results', { kind: 'toggleFullscreen' }],
  ])('does not guard on the %s screen, nor mute and full screen (%j)', (screen, command) => {
    expect(passesGameOverGuard(screen, command, 0)).toBe(true);
  });
});
