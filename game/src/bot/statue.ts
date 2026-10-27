import { NO_CONTROLS } from '../sim/controls';
import type { Bot } from './view';

/** The bot that never plays: it sends no input at all, for a baseline of what a galaxy does to an idle ship. */
export const STATUE: Bot = { decide: () => NO_CONTROLS };
