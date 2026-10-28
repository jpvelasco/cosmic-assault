import { STEP_SECONDS } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { Bolts } from '../../src/sim/foes/bolts';
import type { Foe } from '../../src/sim/foes/foe';
import { FoeField, type FoeHooks } from '../../src/sim/foes/foeField';
import { createRng } from '../../src/sim/rng';
import { createShip } from '../../src/sim/ship';
import { BOSS_FIELD, stubArena, type StubArena } from './bossArena';

/** A foe field on a stub arena with bolts of its own, noting the base points it scores and where its kills fell. */
export interface FoeRig {
  readonly arena: StubArena;
  readonly foes: FoeField;
  readonly bolts: Bolts;
  readonly points: number[];
  readonly killed: { x: number; y: number }[];
}

/** A `FoeRig` from stream `seed` on `field`, its ship at (shipX, shipY), the field's centre by default, past its start-of-run invulnerability. */
export function foeRig(opts: { seed?: number; field?: Field; shipX?: number; shipY?: number } = {}): FoeRig {
  const { seed = 1, field = BOSS_FIELD, shipX = field.width / 2, shipY = field.height / 2 } = opts;
  const ship = createShip(shipX, shipY);
  // Foes spare an invulnerable ship.
  ship.invulnerable = false;
  const arena = stubArena(ship, field);
  const points: number[] = [];
  const killed: { x: number; y: number }[] = [];
  const hooks: FoeHooks = {
    score: (base) => {
      points.push(base);
      return base;
    },
    killed: (x, y) => {
      killed.push({ x, y });
    },
  };
  const bolts = new Bolts(arena);
  return { arena, foes: new FoeField(arena, createRng(seed), hooks, bolts), bolts, points, killed };
}

export type Logged = { readonly t: number; readonly event: SimEvent };

/** Steps the foes and their bolts `seconds` on, clearing each step's events first as a World does; returns each event with its time. */
export function runFoes(r: FoeRig, seconds: number, each?: (t: number) => void): Logged[] {
  const log: Logged[] = [];
  for (let i = 1; i <= Math.round(seconds / STEP_SECONDS); i++) {
    r.arena.events.length = 0;
    r.foes.step(STEP_SECONDS);
    r.bolts.step(STEP_SECONDS);
    for (const event of r.arena.events) log.push({ t: i * STEP_SECONDS, event: { ...event } });
    each?.(i * STEP_SECONDS);
    r.foes.sweep();
  }
  return log;
}

/** The rig's one foe; fails if none has arrived. */
export function onlyFoe(r: FoeRig): Foe {
  const foe = r.foes.list[0];
  if (foe === undefined) throw new Error('a foe should have arrived: spawn one first');
  return foe;
}
