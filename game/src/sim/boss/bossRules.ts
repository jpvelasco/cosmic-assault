import type { BossDef } from '../../content/bosses';
import { MIN_WINDUP_SECONDS } from '../../content/pacingRules';
import type { AttackId } from '../../content/types';
import type { Field } from '../field';
import type { Point } from '../math';
import type { AttackSpec, BossBehaviour, BossPhase, BossThreat, BossView } from './behaviour';

// The rules every boss fight keeps, apart from the runner that steps one: where a boss arrives, where a shot does harm,
// how its HP sets its phase, and what its definition and behaviour must hold. Where a ship respawns clear of it is
// sim/respawn.ts's.

/** Where a boss arrives, as a share of the field height from the top. */
const HOME_HEIGHT_SHARE = 0.28;
/** The most speed a boss's shove leaves the ship with, in units per second; a ship already faster only keeps from gaining. */
export const MAX_SHOVE_SPEED = 300;

/** Where a boss arrives in `field`. */
export function bossHome(field: Field): Readonly<Point> {
  return { x: field.width / 2, y: field.height * HOME_HEIGHT_SHARE };
}

export function phaseFor(hp: number, maxHp: number): BossPhase {
  if (hp * 3 <= maxHp) return 3;
  return hp * 3 <= maxHp * 2 ? 2 : 1;
}

/** Where a shot does harm now: wherever the boss's behaviour says, by default the core if it can be hurt, else a live part; nowhere outside the fight. */
export function bossTarget(view: Readonly<BossView>): Readonly<Point> | null {
  return view.state === 'fighting' ? view.target : null;
}

/** Where a shot harms a boss whose behaviour does not say: the core if it can be hurt, else its first live part that is not armoured. */
export function coreOrPart(view: Readonly<BossView>): Readonly<Point> | null {
  if (view.vulnerable) return view;
  for (const part of view.parts) if (part.hp > 0 && part.armoured !== true) return part;
  return null;
}

export function assertAttacks(def: BossDef, behaviour: BossBehaviour): void {
  def.phases.forEach((list, i) => {
    for (const id of list) {
      if (behaviour.attacks[id] === undefined) throw new RangeError(`${def.id}'s phase ${String(i + 1)} names attack ${id}, which its behaviour lacks: add ${id} to the behaviour's attacks, or drop it from the phase`);
    }
  });
  for (const [id, spec] of Object.entries(behaviour.attacks)) {
    if (!(spec.windup >= MIN_WINDUP_SECONDS)) {
      throw new RangeError(`attack ${id} has a windup of ${String(spec.windup)} s, under the ${String(MIN_WINDUP_SECONDS)} s minimum: give it a telegraph of at least ${String(MIN_WINDUP_SECONDS)} s`);
    }
  }
}

/** `attack`'s threat as the bots read it, resolved for a boss whose core has `radius`. */
export function bossThreat(attack: AttackId, spec: Readonly<AttackSpec>, radius: number): BossThreat {
  const { windup, threat } = spec;
  if (threat === undefined) return { attack, windup, kind: 'none', reach: 0, speed: 0 };
  if (threat.kind === 'shove') return { attack, windup, kind: 'shove', reach: threat.reach, speed: threat.speed };
  if (threat.kind === 'ring') return { attack, windup, kind: 'ring', reach: threat.reach, speed: 0, ring: { radius: threat.radius, around: threat.around } };
  return { attack, windup, kind: 'lane', reach: threat.reach === 'core' ? radius : threat.reach, speed: 0 };
}

export function assertDamage(damage: number): void {
  if (!(damage > 0 && Number.isFinite(damage))) {
    throw new RangeError(`boss damage must be a positive finite damage (got ${String(damage)}): pass 1 for a shot`);
  }
}
