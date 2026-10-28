import { FOES } from '../../src/content/foes';
import type { FoeKind } from '../../src/content/types';
import type { Foe } from '../../src/sim/foes/foe';

/** A foe of `kind` at rest at (x, y), with its content radius and HP; `over` replaces any field. */
export const foeAt = (kind: FoeKind, x: number, y: number, over: Partial<Foe> = {}): Foe => ({
  id: 0, kind, x, y, vx: 0, vy: 0, px: x, py: y, rotation: 0, protation: 0, spin: 0, radius: FOES[kind].radius, hp: FOES[kind].hp, fromAttack: false,
  timer: 0, charging: false, aimX: 0, aimY: 0, orbit: 1, ...over,
});
