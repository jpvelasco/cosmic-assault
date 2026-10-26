import { clamp } from '../../content/curves';
import { createAsteroid, type AsteroidSize } from '../asteroid';
import { ASTEROID } from '../config';
import { TAU } from '../math';
import type { AttackContext, BossBehaviour, BossPhase } from './bossRunner';

/** Rocks in a ring, by phase. */
const RING_COUNTS: Readonly<Record<BossPhase, number>> = { 1: 6, 2: 8, 3: 10 };
/** Small, so that a shot ring breaks into pass-through fragments rather than rocks that wrap. */
const SHARD_SIZE: AsteroidSize = 2;
/** Shards fly faster than the director's rocks of the same size. */
const SHARD_SPEED = 1.5;
const LUNGE_SECONDS = 0.8;

/** Sends a ring of pass-through rocks out from the core, evenly spaced and turned by a random offset. */
function shardRing(ctx: AttackContext): void {
  const { arena, boss, rng } = ctx;
  const count = RING_COUNTS[boss.phase];
  const spacing = TAU / count;
  const offset = rng.range(0, spacing);
  const reach = boss.radius + ASTEROID.radii[SHARD_SIZE];
  for (let i = 0; i < count; i++) {
    const angle = offset + i * spacing;
    const rock = createAsteroid(rng, boss.x + Math.cos(angle) * reach, boss.y + Math.sin(angle) * reach, SHARD_SIZE, angle, ctx.rockSpeed * SHARD_SPEED, arena.shapeRng, arena.nextId());
    rock.transient = true;
    arena.asteroids.push(rock);
  }
}

/** Dashes in a straight line to where the ship was when the windup began, stopping short of the field's edge. */
function lunge(ctx: AttackContext): void {
  const { boss } = ctx;
  const { width, height } = ctx.arena.field();
  const progress = Math.min(1, (ctx.age + ctx.dt) / LUNGE_SECONDS);
  const toX = clamp(ctx.aimX, boss.radius, width - boss.radius);
  const toY = clamp(ctx.aimY, boss.radius, height - boss.radius);
  boss.x = ctx.fromX + (toX - ctx.fromX) * progress;
  boss.y = ctx.fromY + (toY - ctx.fromY) * progress;
}

/** M4's placeholder boss: a slow-drifting core that rings itself with shards and lunges at the ship. */
export const SENTINEL: BossBehaviour = {
  driftSpeed: 20,
  attacks: {
    shardRing: { windup: 0.6, active: 0, run: shardRing },
    lunge: { windup: 0.5, active: LUNGE_SECONDS, run: lunge },
  },
};
