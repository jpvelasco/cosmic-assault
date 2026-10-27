import type { AttackId, BossId, Dimension } from './types';

export interface BossDef {
  readonly id: BossId;
  readonly name: string;
  /** Hit points in Dimension 1; `bossHp` adds the Dimension's share. */
  readonly hp: number;
  /** Radius of the core; a boss with parts (sim/boss) is struck and strikes through them too. */
  readonly radius: number;
  /** The attacks of each of its three phases, in order; a phase repeats its list. The phase changes at two thirds and one third of its HP. */
  readonly phases: readonly (readonly AttackId[])[];
  /** Seconds it rests between attacks in each phase, shrinking. */
  readonly rest: readonly [number, number, number];
}

const HP_PER_DIMENSION = 6;

/** The boss roster: the Monolith guards 1-★, and M4's Sentinel stands in for the bosses still to come. */
export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  monolith: {
    id: 'monolith',
    name: 'Monolith',
    hp: 60,
    radius: 90,
    phases: [['shardVolley'], ['shardVolley', 'quake'], ['quake', 'shardVolley', 'pulse']],
    rest: [2.0, 1.5, 1.0],
  },
  sentinel: {
    id: 'sentinel',
    name: 'Sentinel',
    hp: 20,
    radius: 70,
    phases: [['shardRing'], ['shardRing', 'lunge'], ['lunge', 'shardRing', 'shardRing']],
    rest: [2.2, 1.6, 1.1],
  },
};

/** A boss's hit points in `dimension`: its base HP plus 6 for each Dimension past the first. */
export const bossHp = (boss: Pick<BossDef, 'hp'>, dimension: Dimension): number => boss.hp + HP_PER_DIMENSION * (dimension - 1);
