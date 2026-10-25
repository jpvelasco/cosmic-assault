import type { Command } from './commands';
import type { AppMode } from './game';

/** How long the game-over card ignores restart and title input, so a held key or mashed tap cannot skip the score. */
export const GAME_OVER_GUARD_MS = 700;

/** Whether `command` may run `msSinceGameOver` after the run ended: on the game-over card, start and toTitle wait out the guard. */
export function passesGameOverGuard(mode: AppMode, command: Command, msSinceGameOver: number): boolean {
  const guarded = mode === 'gameOver' && (command.kind === 'start' || command.kind === 'toTitle');
  return !guarded || msSinceGameOver >= GAME_OVER_GUARD_MS;
}
