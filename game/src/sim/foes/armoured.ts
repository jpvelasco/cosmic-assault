import { ARMOURED } from '../../content/foes';
import { turnBetween } from '../math';
import { drift, spawnDrifting } from './drift';
import type { FoeBehaviour } from './foe';
import { breakInto } from './shatter';

/** A shard of an armoured rock is a small rock, the size a rock of its weight breaks down to. */
const SHARD_SIZE = 2;

/**
 * An armoured rock: a plated rock that drifts and wraps like a rock, is pulled by gravity like one, and turns aside any
 * shot that strikes outside its soft arc, `ARMOURED.softArc` either side of its facing. It breaks into `ARMOURED.shards`
 * small rocks, which are rocks: they wrap, split and are shot like any other.
 */
export const ARMOURED_BEHAVIOUR: FoeBehaviour = {
  spawn(world, count, speedMultiplier) {
    spawnDrifting(world, 'armoured', count, speedMultiplier, ARMOURED.spin);
  },

  step: drift,

  deflects(foe, x, y) {
    return Math.abs(turnBetween(foe.rotation, Math.atan2(y - foe.y, x - foe.x))) > ARMOURED.softArc;
  },

  destroyed(foe, world) {
    breakInto(foe, world, ARMOURED.shards, SHARD_SIZE, 1, false);
  },
};
