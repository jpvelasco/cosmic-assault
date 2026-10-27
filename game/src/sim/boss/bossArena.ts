import { ASTEROID, PLAYER } from '../config';
import type { Field } from '../field';
import type { Moving } from '../math';
import type { Arena } from '../rules';
import type { BossView, Point } from './behaviour';
import { clearSpot } from './bossRules';
import { BossRunner, type HitResult, type PartHitResult } from './bossRunner';

/**
 * Where a galaxy's boss meets everything else, once it has arrived: the player's shots and blasts strike it here, which
 * reports and scores each blow, and the ship touches it, is shoved by it and respawns clear of it here.
 */
export class BossArena {
  private current: BossRunner | null = null;

  constructor(
    private readonly arena: Arena,
    /** What beating the boss is worth before the combo. */
    private readonly killPoints: number,
    /** The points a kill worth `base` scores, once the combo has counted it. */
    private readonly scoreKill: (base: number) => number,
    /** Makes the fight as the boss arrives. */
    private readonly arrive: () => BossRunner,
  ) {}

  /** The fight, once the boss has arrived. */
  get runner(): BossRunner | null {
    return this.current;
  }

  /** The boss, once it has arrived; the same object every step. */
  get view(): BossView | null {
    return this.current?.view ?? null;
  }

  /** The boss's HP has hit 0: it is dying, or down. */
  get beaten(): boolean {
    const state = this.current?.state;
    return state === 'dying' || state === 'down';
  }

  /** Brings the boss in, the first time it is asked for, and steps its fight. */
  step(dt: number): void {
    this.current ??= this.arrive();
    this.current.step(dt, this.arena);
  }

  resize(old: Field, field: Field): void {
    this.current?.resize(old, field);
  }

  /** Applies, on the hazard path, the shove the boss's last attack asked for. */
  shove(ship: Moving): void {
    this.current?.shove(ship);
  }

  /**
   * A shot at (x, y) has reached the boss, if it overlaps a live part or the core; true means the shot is spent. A part
   * takes 1 damage, reporting `bossPartHit` or `bossPartBroken`, or a `bossDeflected` at (x, y) while armoured. The core
   * takes 1 damage and reports a `bossHit`, or a `bossDeflected` at (x, y) while shielded or off its weak point, and
   * nothing while invulnerable; the blow that kills it scores its kill points as a combo kill.
   */
  hitBoss(x: number, y: number, radius: number): boolean {
    const boss = this.current;
    if (boss === null || boss.state === 'down') return false;
    const part = boss.partAt(x, y, radius);
    if (part < 0 && !boss.overlaps(x, y, radius)) return false;
    const result = part >= 0 ? this.hitPart(boss, part, 1) : this.hitCore(boss, 1, x, y);
    if (result === 'deflected') this.arena.events.push({ type: 'bossDeflected', x, y });
    return true;
  }

  /** Takes `damage` off the core for a blow at (x, y): a hurt core reports a `bossHit`, and the blow that kills it scores. */
  hitCore(boss: BossRunner, damage: number, x: number, y: number): HitResult {
    const result = boss.hit(damage, x, y);
    if (result === 'hit' || result === 'killed') this.arena.events.push({ type: 'bossHit', x, y, hp: boss.hp });
    if (result === 'killed') this.arena.award(this.scoreKill(this.killPoints));
    return result;
  }

  /** Takes `damage` off live part `index`: a hurt part reports `bossPartHit` or `bossPartBroken`. */
  hitPart(boss: BossRunner, index: number, damage: number): PartHitResult {
    const result = boss.hitPart(index, damage);
    const part = boss.view.parts[index];
    if ((result === 'hit' || result === 'broken') && part !== undefined) {
      const { x, y } = part;
      this.arena.events.push(result === 'broken' ? { type: 'bossPartBroken', part: index, x, y } : { type: 'bossPartHit', part: index, x, y, hp: part.hp });
    }
    return result;
  }

  /** True when a circle at (x, y) touches a boss that is fighting, its core or a live part; the intro and dying are harmless. */
  touches(x: number, y: number, radius: number): boolean {
    return this.current?.state === 'fighting' && this.current.touches(x, y, radius);
  }

  /** While the boss is on the field, where a respawning ship comes back clear of its reach; null once it is down, or before it arrives. */
  respawnPoint(): Readonly<Point> | null {
    const boss = this.current;
    if (boss === null || boss.state === 'down') return null;
    return clearSpot(boss.view, boss.reach + PLAYER.radius + ASTEROID.safeRadius, this.arena.field());
  }
}
