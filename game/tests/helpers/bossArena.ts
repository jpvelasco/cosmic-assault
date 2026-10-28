import { ASTEROID, STEP_SECONDS } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import type { Field } from '../../src/sim/field';
import { createRng } from '../../src/sim/rng';
import type { Arena } from '../../src/sim/rules';
import { createShip, type Ship } from '../../src/sim/ship';

export const BOSS_FIELD: Field = { width: 1280, height: 720 };

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
