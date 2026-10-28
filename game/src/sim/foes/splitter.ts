import { FRAGMENT_SPEED_MULTIPLIER, SPLITTER_FRAGMENTS } from '../../content/foes';
import { ASTEROID } from '../config';
import { drift, spawnDrifting } from './drift';
import type { FoeBehaviour } from './foe';
import { breakInto } from './shatter';

const TINY = 3;

/**
 * A rock that takes two hits and breaks into three fast, tiny fragments. It drifts and wraps like a rock, enters the way
 * a rock does and is pulled by gravity wells like one. Its fragments are made by the rock path, `transient` like a
 * meteor's: they pass through the field and never split.
 */
export const SPLITTER: FoeBehaviour = {
  spawn(world, count, speedMultiplier) {
    spawnDrifting(world, 'splitter', count, speedMultiplier, ASTEROID.spinMax);
  },

  step: drift,

  destroyed(foe, world) {
    breakInto(foe, world, SPLITTER_FRAGMENTS, TINY, FRAGMENT_SPEED_MULTIPLIER, true);
  },
};
