import type { Command } from './commands';
import { END_SCREENS, type Screen } from './flow';

/** How long an end card (results, game over, Rank complete) ignores its input, so a held key or mashed tap cannot skip the score. */
export const GAME_OVER_GUARD_MS = 700;

/** Whether `command` may run `msSinceRunEnd` after the run ended: on an end card everything but mute and full screen waits out the guard. */
export function passesGameOverGuard(screen: Screen, command: Command, msSinceRunEnd: number): boolean {
  const guarded = END_SCREENS.includes(screen) && command.kind !== 'toggleMute' && command.kind !== 'toggleFullscreen';
  return !guarded || msSinceRunEnd >= GAME_OVER_GUARD_MS;
}
