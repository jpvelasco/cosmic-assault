import { FOES } from '../../src/content/foes';
import type { FoeKind } from '../../src/content/types';
import type { Foe } from '../../src/sim/foes/foe';
import type { HazardFoes } from '../../src/sim/hazards/hazard';

/** A foe of `kind` at rest at (x, y), with its content radius and HP; `over` replaces any field. */
export const foeAt = (kind: FoeKind, x: number, y: number, over: Partial<Foe> = {}): Foe => ({
  id: 0, kind, x, y, vx: 0, vy: 0, px: x, py: y, rotation: 0, protation: 0, spin: 0, radius: FOES[kind].radius, hp: FOES[kind].hp, fromAttack: false,
  timer: 0, charging: false, aimX: 0, aimY: 0, orbit: 1, ...over,
});

/** `list` as the hazards see the foes, for a test no black hole's horizon reaches into: a swallow fails it. */
export const hazardFoes = (...list: Foe[]): HazardFoes => ({
  list,
  swallow: (foe) => {
    throw new Error(`foe ${String(foe.id)} was swallowed, but these stand-in foes are for tests no horizon reaches: build the test on a FoeField (foeRig)`);
  },
});
