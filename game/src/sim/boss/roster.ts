import type { BossId } from '../../content/types';
import type { BossFactory } from './behaviour';
import { createHiveCarrier } from './hiveCarrier';
import { createLeviathan } from './leviathan';
import { createMonolith } from './monolith';
import { SENTINEL } from './sentinel';
import { createWarden } from './warden';

/** How each boss fights, made afresh for each fight. */
export const BOSS_BEHAVIOURS: Readonly<Record<BossId, BossFactory>> = { monolith: createMonolith, hiveCarrier: createHiveCarrier, sentinel: () => SENTINEL, warden: createWarden, leviathan: createLeviathan };
