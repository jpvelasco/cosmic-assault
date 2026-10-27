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
  /**
   * HP the core loses each time one of its parts breaks, shielded or not (M6-R9): it can move the boss to its next phase,
   * but never kills it, which takes a blow on the core. None if absent.
   */
  readonly partBreakDamage?: number;
}

const HP_PER_DIMENSION = 6;

/** The boss roster: the Monolith guards 1-★, the Hive Carrier 2-★, the Warden 3-★ and the Leviathan 4-★, and M4's Sentinel stands in for the bosses still to come. */
export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  monolith: {
    id: 'monolith',
    name: 'Monolith',
    hp: 36,
    radius: 90,
    phases: [['shardVolley'], ['shardVolley', 'quake'], ['quake', 'shardVolley', 'pulse']],
    rest: [2.5, 2.0, 1.5],
  },
  hiveCarrier: {
    id: 'hiveCarrier',
    name: 'Hive Carrier',
    // `bossHp` adds a Dimension's share in 2-★, the only galaxy it guards.
    hp: 22,
    radius: 100,
    phases: [['launch', 'broadside'], ['launch', 'retreat', 'broadside'], ['launch', 'broadside', 'launch', 'retreat']],
    rest: [2.5, 2.0, 1.6],
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    // `bossHp` adds two Dimensions' share in 3-★, the only galaxy it guards: 76.
    hp: 64,
    radius: 48,
    phases: [['turretVolley', 'lockOn'], ['turretVolley', 'spin', 'lockOn'], ['ringPulse', 'turretVolley', 'spin', 'lockOn']],
    rest: [2.0, 1.5, 1.0],
  },
  leviathan: {
    id: 'leviathan',
    name: 'Leviathan',
    // `bossHp` adds three Dimensions' share in 4-★, the only galaxy it guards: 88.
    hp: 70,
    radius: 34,
    phases: [['spit', 'dive'], ['dive', 'spit', 'coil'], ['coil', 'dive', 'spit', 'dive']],
    rest: [1.8, 1.4, 1.0],
    partBreakDamage: 6,
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
