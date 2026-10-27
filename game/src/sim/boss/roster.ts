import type { BossId } from '../../content/types';
import type { BossFactory } from './behaviour';
import { createEclipse } from './eclipse';
import { createHiveCarrier } from './hiveCarrier';
import { createLeviathan } from './leviathan';
import { createMonolith } from './monolith';
import { createWarden } from './warden';

/** How each boss fights, made afresh for each fight. */
export const BOSS_BEHAVIOURS: Readonly<Record<BossId, BossFactory>> = { monolith: createMonolith, hiveCarrier: createHiveCarrier, warden: createWarden, leviathan: createLeviathan, eclipse: createEclipse };
