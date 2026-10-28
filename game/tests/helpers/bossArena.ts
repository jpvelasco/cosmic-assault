import type { BossDef } from '../../src/content/bosses';
import { BOSS_INTRO_SECONDS } from '../../src/content/pacingRules';
import { ASTEROID, STEP_SECONDS } from '../../src/sim/config';
import { dashAttack, rockRingAttack } from '../../src/sim/boss/attacks';
import type { AttackSpec, BossBehaviour, BossFactory, BossSetup } from '../../src/sim/boss/behaviour';
import { BossRunner } from '../../src/sim/boss/bossRunner';
import { Bolts } from '../../src/sim/foes/bolts';
import { FoeField } from '../../src/sim/foes/foeField';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { createRng, type Rng } from '../../src/sim/rng';
import type { Arena } from '../../src/sim/rules';
import { createShip, type Ship } from '../../src/sim/ship';

export const BOSS_FIELD: Field = { width: 1280, height: 720 };

/**
 * A stand-in boss for the runner's own tests, with no galaxy of its own: a core of radius 70 and 20 HP that rings itself
 * with pass-through rocks (`quake`) and dashes at the ship (`dive`). The runner reads its id as a boss's, so it takes the
 * Monolith's, which the fixture's numbers and moves do not share.
 */
export const FIXTURE_DEF: BossDef = {
  id: 'monolith',
  name: 'Fixture',
  hp: 20,
  radius: 70,
  phases: [['quake'], ['quake', 'dive'], ['dive', 'quake', 'quake']],
  rest: [2.2, 1.6, 1.1],
};

/** The fixture's behaviour: six rocks in phase 1, eight in phase 2 and ten in phase 3, each ring 0.6 s in its windup; a dash of 0.8 s after 0.5 s of windup. */
export const FIXTURE: BossBehaviour & { readonly attacks: Readonly<{ quake: AttackSpec; dive: AttackSpec }> } = {
  driftSpeed: 20,
  attacks: {
    quake: rockRingAttack(0.6, { 1: 6, 2: 8, 3: 10 }, 2, 1.5),
    dive: dashAttack(0.5, 0.8, FIXTURE_DEF.radius),
  },
};

export interface StubArena extends Arena {
  readonly ship: Ship;
  /** Advances the clock one fixed step; the runner reads time only through `dt`. */
  tick(): void;
}

/** The slice of a World a boss runner sees, with a still ship and a clock that `tick` advances. */
export function stubArena(ship: Ship = createShip(BOSS_FIELD.width / 2, 600), field: Field = BOSS_FIELD): StubArena {
  let elapsed = 0;
  let lastId = 0;
  return {
    asteroids: [],
    events: [],
    ship,
    shapeRng: createRng(7),
    field: () => field,
    elapsed: () => elapsed,
    score: () => 0,
    deaths: () => 0,
    lives: () => 3,
    nextId: () => ++lastId,
    award: () => undefined,
    scoreRock(rock) {
      this.events.push({ type: 'asteroidDestroyed', id: rock.id, x: rock.x, y: rock.y, size: rock.size, points: ASTEROID.scores[rock.size] });
    },
    setStatus: () => undefined,
    tick: () => {
      elapsed += STEP_SECONDS;
    },
  };
}

export interface Timed {
  readonly event: SimEvent;
  readonly at: number;
}

export type Stepper = (dt: number, arena: StubArena) => void;

/** Steps `seconds` of fixed steps, logging each event with the time of the step that made it; each step's events are cleared first, like a World's. */
export function runFor(step: Stepper, arena: StubArena, seconds: number, onStep?: () => void): Timed[] {
  const log: Timed[] = [];
  for (let i = 0; i < Math.round(seconds / STEP_SECONDS); i++) {
    arena.events.length = 0;
    arena.tick();
    step(STEP_SECONDS, arena);
    for (const event of arena.events) log.push({ event: { ...event }, at: arena.elapsed() });
    onStep?.();
  }
  return log;
}

/** The events of one type, narrowed to its shape. */
export function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** The logged events of one type, narrowed to its shape. */
export function timedOfType<T extends SimEvent['type']>(log: readonly Timed[], type: T): (Timed & { event: Extract<SimEvent, { type: T }> })[] {
  return log.filter((l): l is Timed & { event: Extract<SimEvent, { type: T }> } => l.event.type === type);
}

/** The parts of a boss, or of a ring of them, with HP left. */
export const liveParts = <P extends { readonly hp: number }>(of: { readonly parts: readonly P[] }): P[] => of.parts.filter((p) => p.hp > 0);

/** Breaks part `index` of the fight `r` runs with as many 1-damage blows as it takes, while the fight lasts. */
export function breakPart(r: BossRunner, index: number): void {
  while ((r.view.parts[index]?.hp ?? 0) > 0 && r.state === 'fighting') r.hitPart(index, 1);
}

/** A boss's fight on a stub arena, with bolts and foes of its own to fire and launch. */
export interface BossRig {
  readonly r: BossRunner;
  readonly arena: StubArena;
  readonly bolts: Bolts;
  readonly foes: FoeField;
}

/** What a rig is made with: the fight's seed, or its own stream in place of one drawn from it; its arena; and the seed of its foes' stream. */
export interface RigOptions {
  readonly seed?: number;
  readonly rng?: Rng | undefined;
  readonly arena?: StubArena | undefined;
  readonly foesSeed?: number;
}

/** A fight's setup with `maxHp` on `arena` (a fresh stub's by default), drawing from `rng`, else `seed`, with bolts and foes of its own. */
export function bossSetup(maxHp: number, { seed = 1, rng = createRng(seed), arena = stubArena(), foesSeed = 99 }: RigOptions = {}): BossSetup & { readonly bolts: Bolts; readonly foes: FoeField } {
  const bolts = new Bolts(arena);
  const foes = new FoeField(arena, createRng(foesSeed), { score: (base) => base, killed: () => undefined });
  return { maxHp, rng, rockSpeed: 1, field: arena.field(), bolts, foes };
}

/** Boss `def`, made by `make` with `maxHp`, on `arena` (a fresh stub's by default), its fight drawn from `seed`. */
export function bossRig(def: BossDef, make: BossFactory, maxHp: number, options: RigOptions = {}): BossRig {
  const arena = options.arena ?? stubArena();
  const setup = bossSetup(maxHp, { ...options, arena });
  return { r: new BossRunner(def, make(setup), setup), arena, bolts: setup.bolts, foes: setup.foes };
}

/** Steps a rig's bolts, its foes, then its boss, as a galaxy does. */
export const rigStepper = (rig: BossRig): Stepper => (dt, arena) => {
  rig.bolts.step(dt);
  rig.foes.step(dt);
  rig.r.step(dt, arena);
};

/** Steps the fight `r` runs, the boss alone. */
export const bossStepper = (r: BossRunner): Stepper => (dt, arena) => {
  r.step(dt, arena);
};

/** Steps `step` (the boss alone, by default) through the intro of the fight `r` runs and into the fight; fails if it has not begun. */
export function throughIntro(r: BossRunner, arena: StubArena, step: Stepper = bossStepper(r)): void {
  runFor(step, arena, BOSS_INTRO_SECONDS + 0.05);
  if (r.state !== 'fighting') throw new Error(`${r.view.id} is ${r.state} after its intro, not fighting: check its intro length`);
}

/** `bossRig`, stepped through the boss's intro into its fight; fails if the fight has not begun. */
export function fightingRig(def: BossDef, make: BossFactory, maxHp: number, options: RigOptions = {}): BossRig {
  const rig = bossRig(def, make, maxHp, options);
  throughIntro(rig.r, rig.arena, rigStepper(rig));
  return rig;
}
