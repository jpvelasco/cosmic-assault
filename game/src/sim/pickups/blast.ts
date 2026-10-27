import type { BlastKind } from '../../content/pickups';
import type { BossArena } from '../boss/bossArena';
import { BLAST } from '../config';
import type { Arena } from '../rules';
import { overlapsAcrossWrap, wrapDelta } from '../wrap';

/** What a blast reaches in the galaxy run, and how the run scores and reports what it hurts. */
export interface BlastScene {
  readonly arena: Arena;
  /** The foes on the field: those in range are destroyed for score, leaving nothing behind. */
  readonly foes: { blast(x: number, y: number, radius: number): void };
  /** The boss, once it has arrived, which reports and scores the blast's blows on it as a shot's. */
  readonly bosses: Pick<BossArena, 'runner' | 'hitCore' | 'hitPart'>;
}

/**
 * Sets off a Field Bomb or a Nova at (x, y). It destroys every rock and foe it reaches, across the wrap as homing
 * measures it, for score through the combo, but nothing it kills drops a pickup and no rock splits (M6-R5). A fighting boss takes the blast's part damage on each live
 * part it reaches, then its core damage if the core is in reach: the blow lands on the core's rim toward the blast, so
 * a shielded core, or one hurt only from another side, takes none, silently.
 */
export function blast(kind: BlastKind, x: number, y: number, scene: BlastScene): void {
  const { radius, coreDamage, partDamage } = BLAST[kind];
  scene.arena.events.push({ type: 'blast', kind, x, y, radius });
  clearRocks(x, y, radius, scene);
  scene.foes.blast(x, y, radius);
  const { bosses } = scene;
  const boss = bosses.runner;
  if (boss?.state !== 'fighting') return;
  const { view } = boss;
  const field = scene.arena.field();
  for (let i = 0; i < view.parts.length; i++) {
    const part = view.parts[i];
    if (part !== undefined && part.hp > 0 && overlapsAcrossWrap(field, x, y, radius, part.x, part.y, part.radius)) bosses.hitPart(boss, i, partDamage);
  }
  if (!overlapsAcrossWrap(field, x, y, radius, view.x, view.y, view.radius)) return;
  const away = Math.atan2(wrapDelta(y - view.y, field.height), wrapDelta(x - view.x, field.width));
  bosses.hitCore(boss, coreDamage, view.x + Math.cos(away) * view.radius, view.y + Math.sin(away) * view.radius);
}

/** Destroys every rock the blast reaches, whole, for its points through the combo. */
function clearRocks(x: number, y: number, radius: number, { arena }: BlastScene): void {
  const { asteroids } = arena;
  const field = arena.field();
  let kept = 0;
  for (const a of asteroids) {
    if (overlapsAcrossWrap(field, x, y, radius, a.x, a.y, a.radius)) arena.scoreRock(a);
    else asteroids[kept++] = a;
  }
  asteroids.length = kept;
}
