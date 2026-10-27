import type { BlastKind } from '../../content/pickups';
import type { BossRunner } from '../boss/bossRunner';
import { circlesOverlap } from '../collision';
import { ASTEROID, BLAST } from '../config';
import type { Arena } from '../rules';

/** What a blast reaches in the galaxy run, and how the run scores and reports what it hurts. */
export interface BlastScene {
  readonly arena: Arena;
  /** The foes on the field: those in range are destroyed for score, leaving nothing behind. */
  readonly foes: { blast(x: number, y: number, radius: number): void };
  /** The boss, once it has arrived. */
  boss(): BossRunner | null;
  /** The points a kill worth `base` scores, counting it in the combo. */
  score(base: number): number;
  /** Takes `damage` off the boss's core for a blow landing at (x, y), reporting and scoring it as a shot's. */
  hitCore(boss: BossRunner, damage: number, x: number, y: number): void;
  /** Takes `damage` off live part `index`, reporting it as a shot's. */
  hitPart(boss: BossRunner, index: number, damage: number): void;
}

/**
 * Sets off a Field Bomb or a Nova at (x, y). It destroys every rock and foe it reaches for score through the combo, but
 * nothing it kills drops a pickup and no rock splits (M6-R5). A fighting boss takes the blast's part damage on each live
 * part it reaches, then its core damage if the core is in reach: the blow lands on the core's rim toward the blast, so
 * a shielded core, or one hurt only from another side, takes none, silently.
 */
export function blast(kind: BlastKind, x: number, y: number, scene: BlastScene): void {
  const { radius, coreDamage, partDamage } = BLAST[kind];
  scene.arena.events.push({ type: 'blast', kind, x, y, radius });
  clearRocks(x, y, radius, scene);
  scene.foes.blast(x, y, radius);
  const boss = scene.boss();
  if (boss?.state !== 'fighting') return;
  const { view } = boss;
  for (let i = 0; i < view.parts.length; i++) {
    const part = view.parts[i];
    if (part !== undefined && part.hp > 0 && circlesOverlap(x, y, radius, part.x, part.y, part.radius)) scene.hitPart(boss, i, partDamage);
  }
  if (!circlesOverlap(x, y, radius, view.x, view.y, view.radius)) return;
  const away = Math.atan2(y - view.y, x - view.x);
  scene.hitCore(boss, coreDamage, view.x + Math.cos(away) * view.radius, view.y + Math.sin(away) * view.radius);
}

/** Destroys every rock the blast reaches, whole, for its points through the combo. */
function clearRocks(x: number, y: number, radius: number, scene: BlastScene): void {
  const { asteroids, events } = scene.arena;
  let kept = 0;
  for (const a of asteroids) {
    if (!circlesOverlap(x, y, radius, a.x, a.y, a.radius)) {
      asteroids[kept++] = a;
      continue;
    }
    const points = scene.score(ASTEROID.scores[a.size]);
    scene.arena.award(points);
    events.push({ type: 'asteroidDestroyed', id: a.id, x: a.x, y: a.y, size: a.size, points });
  }
  asteroids.length = kept;
}
