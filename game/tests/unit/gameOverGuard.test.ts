import { describe, expect, it } from 'vitest';
import { commandForKey, START, TO_TITLE, type Command } from '../../src/app/commands';
import type { AppMode } from '../../src/app/game';
import { GAME_OVER_GUARD_MS, passesGameOverGuard } from '../../src/app/gameOverGuard';

/** Every way to leave the game-over card: its keys, and the commands its buttons send. */
const GAME_OVER_INPUTS: readonly [string, Command | null][] = [
  ['R', commandForKey('gameOver', 'KeyR')],
  ['Escape', commandForKey('gameOver', 'Escape')],
  ['the Restart button', START],
  ['the Title button', TO_TITLE],
];

describe('passesGameOverGuard', () => {
  it('guards for 700 ms', () => {
    expect(GAME_OVER_GUARD_MS).toBe(700);
  });

  it.each(GAME_OVER_INPUTS)('ignores %s on the game-over card before 700 ms', (_input, command) => {
    if (command === null) throw new Error('every game-over input must map to a command');
    for (const ms of [0, 16, 350, 699.9]) {
      expect(passesGameOverGuard('gameOver', command, ms)).toBe(false);
    }
  });

  it.each(GAME_OVER_INPUTS)('accepts %s from 700 ms on', (_input, command) => {
    if (command === null) throw new Error('every game-over input must map to a command');
    for (const ms of [700, 700.1, 5000]) {
      expect(passesGameOverGuard('gameOver', command, ms)).toBe(true);
    }
  });

  it.each<[AppMode, Command]>([
    ['title', START],
    ['playing', { kind: 'togglePause' }],
    ['paused', TO_TITLE],
    ['gameOver', { kind: 'togglePause' }],
  ])('does not guard on the %s screen or for other commands (%j)', (mode, command) => {
    expect(passesGameOverGuard(mode, command, 0)).toBe(true);
  });
});
