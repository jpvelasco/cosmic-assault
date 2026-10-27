import type { BossId } from '../../content/types';
import type { BossFactory } from './behaviour';
import { createHiveCarrier } from './hiveCarrier';
import { createMonolith } from './monolith';
import { SENTINEL } from './sentinel';

/** How each boss fights, made afresh for each fight. */
export const BOSS_BEHAVIOURS: Readonly<Record<BossId, BossFactory>> = { monolith: createMonolith, hiveCarrier: createHiveCarrier, sentinel: () => SENTINEL };
