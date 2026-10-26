import type { BossDef } from '../../content/bosses';
import { clamp } from '../../content/curves';
import { BOSS_INTRO_SECONDS } from '../../content/pacingRules';
import type { AttackId } from '../../content/types';
import { circlesOverlap } from '../collision';
import type { Field } from '../field';
import { TAU, TIME_EPSILON } from '../math';
import type { Rng } from '../rng';
import type { Arena } from '../rules';
import { rescale } from '../wrap';

/** The shortest telegraph an attack may have: players need this long to see it coming. */
export const MIN_WINDUP_SECONDS = 0.35;
/** How long a beaten boss takes to die; the renderer fades it over this. */
export const DYING_SECONDS = 2;
/** Where a boss arrives, as a share of the field height from the top. */
const HOME_HEIGHT_SHARE = 0.28;

export type BossState = 'intro' | 'fighting' | 'dying' | 'down';
export type BossPhase = 1 | 2 | 3;
export type HitResult = 'blocked' | 'hit' | 'killed';

/** What the renderer sees of a boss: one object, updated in place by `BossRunner.step`. */
export interface BossView {
  x: number;
  y: number;
  /** Position before the latest step, for interpolated drawing. */
  px: number;
  py: number;
  radius: number;
  hp: number;
  maxHp: number;
  phase: BossPhase;
  state: BossState;
  /** The attack being telegraphed, else null. */
  windup: AttackId | null;
}

/** What an attack sees and may change. Refilled in place every step. */
export interface AttackContext {
  arena: Arena;
  readonly rng: Rng;
  readonly rockSpeed: number;
  /** The boss; an attack may move its core. */
  readonly boss: BossView;
  /** This step's length. */
  dt: number;
  /** Seconds since the attack went active, before this step. */
  age: number;
  /** Where the ship was when the windup began. */
  aimX: number;
  aimY: number;
  /** Where the core was when the attack went active. */
  fromX: number;
  fromY: number;
}

export interface AttackSpec {
  /** Seconds of telegraph, at least `MIN_WINDUP_SECONDS`. The attack does nothing until it ends. */
  readonly windup: number;
  /** Seconds the attack runs for; 0 runs it once. */
  readonly active: number;
  /** Called every step of the active time. */
  run(ctx: AttackContext): void;
}

/** How a boss acts: the attacks its definition names, and how fast its core drifts between them. */
export interface BossBehaviour {
  readonly attacks: Readonly<Record<AttackId, AttackSpec>>;
  /** px per second. */
  readonly driftSpeed: number;
}

export interface BossSetup {
  readonly maxHp: number;
  /** The 'boss' stream: the drift heading and whatever an attack draws. */
  readonly rng: Rng;
  /** Multiplier for the speed of rocks an attack launches. */
  readonly rockSpeed: number;
  readonly field: Field;
}

/** Where a boss arrives in `field`. */
export function bossHome(field: Field): { readonly x: number; readonly y: number } {
  return { x: field.width / 2, y: field.height * HOME_HEIGHT_SHARE };
}

function phaseFor(hp: number, maxHp: number): BossPhase {
  if (hp * 3 <= maxHp) return 3;
  return hp * 3 <= maxHp * 2 ? 2 : 1;
}

function assertWindups(behaviour: BossBehaviour): void {
  for (const [id, spec] of Object.entries(behaviour.attacks)) {
    if (!(spec.windup >= MIN_WINDUP_SECONDS)) {
      throw new RangeError(`attack ${id} has a windup of ${String(spec.windup)} s, under the ${String(MIN_WINDUP_SECONDS)} s minimum: give it a telegraph of at least ${String(MIN_WINDUP_SECONDS)} s`);
    }
  }
}

/**
 * A phased boss fight: a 2 s intro, then rests and attacks (each a telegraphed windup, then its active time)
 * through three phases, then 2 s of dying, announced with `bossDown` as it starts. It cannot be hurt in the intro or
 * dying. Everything it does is driven by `step` and its seeded stream, so a fight replays exactly.
 */
export class BossRunner {
  readonly view: BossView;
  /** The core's drift velocity, px per second. */
  private dx: number;
  private dy: number;
  private context: AttackContext | null = null;
  /** Seconds in the current state, or in the current rest, windup or active stage. */
  private clock = 0;
  private stage: 'rest' | 'windup' | 'active' = 'rest';
  private attackId: AttackId | null = null;
  /** Where in its phase's attack list the next attack is. */
  private cursor = 0;
  /** The highest phase announced with a `bossPhase` event. */
  private announced: BossPhase = 1;

  constructor(
    private readonly def: BossDef,
    private readonly behaviour: BossBehaviour,
    private readonly setup: BossSetup,
  ) {
    assertWindups(behaviour);
    const home = bossHome(setup.field);
    this.view = { x: home.x, y: home.y, px: home.x, py: home.y, radius: def.radius, hp: setup.maxHp, maxHp: setup.maxHp, phase: 1, state: 'intro', windup: null };
    const heading = setup.rng.range(0, TAU);
    this.dx = Math.cos(heading) * behaviour.driftSpeed;
    this.dy = Math.sin(heading) * behaviour.driftSpeed;
  }

  get hp(): number {
    return this.view.hp;
  }

  get phase(): BossPhase {
    return this.view.phase;
  }

  get state(): BossState {
    return this.view.state;
  }

  /** Stretches the core, and the points an attack under way aims at, to the new field like every other entity. */
  resize(old: Field, field: Field): void {
    const { view, context } = this;
    view.x = rescale(view.x, old.width, field.width);
    view.px = rescale(view.px, old.width, field.width);
    view.y = rescale(view.y, old.height, field.height);
    view.py = rescale(view.py, old.height, field.height);
    if (context === null) return;
    context.aimX = rescale(context.aimX, old.width, field.width);
    context.fromX = rescale(context.fromX, old.width, field.width);
    context.aimY = rescale(context.aimY, old.height, field.height);
    context.fromY = rescale(context.fromY, old.height, field.height);
  }

  /** True when a circle at (x, y) overlaps the core. */
  overlaps(x: number, y: number, radius: number): boolean {
    return circlesOverlap(this.view.x, this.view.y, this.view.radius, x, y, radius);
  }

  /**
   * Takes `damage` off its HP and returns what came of it: 'blocked' outside the fight (intro, dying, down),
   * 'killed' for the blow that empties it. Phase changes are announced by the next `step`.
   */
  hit(damage: number): HitResult {
    if (!(damage > 0 && Number.isFinite(damage))) {
      throw new RangeError(`boss damage must be a positive finite damage (got ${String(damage)}): pass 1 for a shot`);
    }
    const view = this.view;
    if (view.state !== 'fighting') return 'blocked';
    view.hp = Math.max(0, view.hp - damage);
    if (view.hp === 0) {
      this.enter('dying');
      return 'killed';
    }
    const phase = phaseFor(view.hp, view.maxHp);
    if (phase > view.phase) {
      view.phase = phase;
      this.cursor = 0;
    }
    return 'hit';
  }

  /** Advances the fight by `dt` seconds, pushing its events into `arena.events` and any rocks into `arena.asteroids`. */
  step(dt: number, arena: Arena): void {
    const view = this.view;
    view.px = view.x;
    view.py = view.y;
    while (this.announced < view.phase) {
      this.announced = (this.announced + 1) as BossPhase;
      arena.events.push({ type: 'bossPhase', phase: this.announced as 2 | 3 });
    }
    switch (view.state) {
      case 'intro':
        this.stepIntro(dt, arena);
        break;
      case 'fighting':
        this.stepFighting(dt, arena);
        break;
      case 'dying':
        this.stepDying(dt, arena);
        break;
      case 'down':
    }
  }

  private reached(seconds: number): boolean {
    return this.clock + TIME_EPSILON >= seconds;
  }

  private enter(state: BossState): void {
    this.view.state = state;
    this.rest();
  }

  /** Drops any attack and starts a fresh timer: the next thing the boss does is wait. */
  private rest(): void {
    this.view.windup = null;
    this.attackId = null;
    this.stage = 'rest';
    this.clock = 0;
  }

  private stepIntro(dt: number, arena: Arena): void {
    if (this.clock === 0) arena.events.push({ type: 'bossIntro', id: this.def.id });
    this.clock += dt;
    if (this.reached(BOSS_INTRO_SECONDS)) this.enter('fighting');
  }

  private stepDying(dt: number, arena: Arena): void {
    if (this.clock === 0) arena.events.push({ type: 'bossDown', id: this.def.id });
    this.clock += dt;
    if (this.reached(DYING_SECONDS)) this.enter('down');
  }

  private stepFighting(dt: number, arena: Arena): void {
    if (this.attackId !== null && this.stage === 'active') {
      this.runAttack(this.attackId, dt, arena);
      return;
    }
    this.drift(dt, arena.field());
    this.clock += dt;
    if (this.attackId === null) {
      if (this.reached(this.def.rest[this.view.phase - 1] ?? 0)) this.beginWindup(arena);
    } else if (this.reached(this.behaviour.attacks[this.attackId].windup)) {
      this.beginActive(arena);
    }
  }

  /** Picks the phase's next attack and starts telegraphing it, noting where the ship is. */
  private beginWindup(arena: Arena): void {
    const view = this.view;
    const list = this.def.phases[view.phase - 1] ?? [];
    const attack = list[this.cursor % list.length];
    if (attack === undefined) throw new RangeError(`${this.def.id} has no attacks in phase ${String(view.phase)}: give each of its phases at least one`);
    this.cursor++;
    this.attackId = attack;
    this.stage = 'windup';
    this.clock = 0;
    view.windup = attack;
    const ctx = this.contextFor(arena);
    ctx.aimX = arena.ship.x;
    ctx.aimY = arena.ship.y;
    arena.events.push({ type: 'bossWindup', attack, x: view.x, y: view.y });
  }

  private beginActive(arena: Arena): void {
    const { view } = this;
    this.stage = 'active';
    this.clock = 0;
    view.windup = null;
    const ctx = this.contextFor(arena);
    ctx.fromX = view.x;
    ctx.fromY = view.y;
  }

  private runAttack(id: AttackId, dt: number, arena: Arena): void {
    const spec = this.behaviour.attacks[id];
    const ctx = this.contextFor(arena);
    ctx.dt = dt;
    ctx.age = this.clock;
    spec.run(ctx);
    this.clock += dt;
    if (this.reached(spec.active)) this.rest();
  }

  private contextFor(arena: Arena): AttackContext {
    this.context ??= { arena, rng: this.setup.rng, rockSpeed: this.setup.rockSpeed, boss: this.view, dt: 0, age: 0, aimX: 0, aimY: 0, fromX: 0, fromY: 0 };
    this.context.arena = arena;
    return this.context;
  }

  /** Moves the core along its heading, bouncing it off the walls so it stays wholly inside the field. */
  private drift(dt: number, field: Field): void {
    const { view } = this;
    const [maxX, maxY] = [field.width - view.radius, field.height - view.radius];
    view.x = clamp(view.x + this.dx * dt, view.radius, maxX);
    view.y = clamp(view.y + this.dy * dt, view.radius, maxY);
    if (view.x === view.radius) this.dx = Math.abs(this.dx);
    else if (view.x === maxX) this.dx = -Math.abs(this.dx);
    if (view.y === view.radius) this.dy = Math.abs(this.dy);
    else if (view.y === maxY) this.dy = -Math.abs(this.dy);
  }
}
