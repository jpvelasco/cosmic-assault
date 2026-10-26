import type { BossId } from './types';

export interface BossDef {
  readonly id: BossId;
  readonly name: string;
}

/** Task 4 adds the fields the boss runner needs. */
export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  sentinel: { id: 'sentinel', name: 'Sentinel' },
};
