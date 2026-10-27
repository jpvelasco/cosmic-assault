import type { AsteroidSize } from '../asteroid';
import { dashAttack, rockRing } from './attacks';
import type { AttackContext, BossBehaviour, BossPhase } from './behaviour';

/** Rocks in a ring, by phase. */
const RING_COUNTS: Readonly<Record<BossPhase, number>> = { 1: 6, 2: 8, 3: 10 };
/** Small, so that a shot ring breaks into pass-through fragments rather than rocks that wrap. */
const SHARD_SIZE: AsteroidSize = 2;
/** Shards fly faster than the director's rocks of the same size. */
const SHARD_SPEED = 1.5;
const LUNGE_SECONDS = 0.8;

/** Sends a ring of pass-through rocks out from the core, more with each phase. */
function shardRing(ctx: AttackContext): void {
  rockRing(ctx, RING_COUNTS[ctx.boss.phase], SHARD_SIZE, SHARD_SPEED);
}

/** M4's placeholder boss: a slow-drifting core that rings itself with shards and lunges (the shared dash) at the ship. */
export const SENTINEL = {
  driftSpeed: 20,
  attacks: {
    shardRing: { windup: 0.6, active: 0, run: shardRing },
    lunge: dashAttack(0.5, LUNGE_SECONDS),
  },
} as const satisfies BossBehaviour;
