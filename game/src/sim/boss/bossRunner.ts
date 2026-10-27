import type { BossDef } from '../../content/bosses';
import { clamp } from '../../content/curves';
import { BOSS_INTRO_SECONDS } from '../../content/pacingRules';
import type { AttackId, BossId } from '../../content/types';
import { circlesOverlap } from '../collision';
import type { Field } from '../field';
import { nudge, TAU, TIME_EPSILON, type Moving } from '../math';
import type { Rng } from '../rng';
import type { Arena } from '../rules';
import { rescale } from '../wrap';

/** The shortest telegraph an attack may have: players need this long to see it coming. */
export const MIN_WINDUP_SECONDS = 0.35;
/** How long a beaten boss takes to die; the renderer fades it over this. */
export const DYING_SECONDS = 2;
/** Where a boss arrives, as a share of the field height from the top. */
const HOME_HEIGHT_SHARE = 0.28;
/** The most speed a boss's shove leaves the ship with, in units per second; a ship already faster only keeps from gaining. */
export const MAX_SHOVE_SPEED = 300;

export type BossState = 'intro' | 'fighting' | 'dying' | 'down';
export type BossPhase = 1 | 2 | 3;
/** What a blow on the core did: nothing outside the fight ('blocked') or while it is shielded ('deflected'). */
export type HitResult = 'blocked' | 'deflected' | 'hit' | 'killed';
/** What a blow on a part did: nothing outside the fight ('blocked'), or it took HP off the part, perhaps the last. */
export type PartHitResult = 'blocked' | 'hit' | 'broken';

/**
 * A piece of a boss apart from its core, an orbiting shard say, with HP of its own. Parts are pooled: one at 0 HP is
 * broken, so it is neither drawn nor struck, until its behaviour sets its HP again.
 */
export interface BossPart {
  x: number;
  y: number;
  /** Position before the latest step, for interpolated drawing. */
  px: number;
  py: number;
  radius: number;
  hp: number;
  maxHp: number;
}

/** What the renderer sees of a boss: one object, updated in place by `BossRunner.step`. */
export interface BossView {
  readonly id: BossId;
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
  /** The attack running, its windup over, else null. */
  active: AttackId | null;
  /** Whether a blow on the core can hurt it now, the intro and dying aside; false while its behaviour shields it. */
  vulnerable: boolean;
  /** Its behaviour's parts, the same objects for the whole fight; none for most bosses. */
  readonly parts: readonly BossPart[];
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
  /**
   * A change to the ship's velocity an attack asks for, in units per second. The runner applies it on the next step's
   * hazard path, capped at `MAX_SHOVE_SPEED`, and zeroes it.
   */
  shoveX: number;
  shoveY: number;
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
  /** At least every attack its definition's phases name. */
  readonly attacks: Readonly<Partial<Record<AttackId, AttackSpec>>>;
  /** px per second. */
  readonly driftSpeed: number;
  /** Its parts, which the runner shows on the view, steps the previous poses of, rescales and strikes. None if absent. */
  readonly parts?: readonly BossPart[];
  /** How far from the core's centre the boss reaches, parts included; its drift keeps that much inside the field. The core radius if absent. */
  readonly reach?: number;
  /** Runs at the end of every step until the boss is down, after its core has drifted or attacked: it moves its parts, say. */
  step?(ctx: AttackContext): void;
  /** Whether a blow on the core can hurt it now; always, if absent. Asked after every step and every part hit. */
  vulnerable?(boss: Readonly<BossView>): boolean;
}

/** Makes a fight's behaviour, which may keep state of its own, from the fight's setup. */
export type BossFactory = (setup: BossSetup) => BossBehaviour;

export interface BossSetup {
  readonly maxHp: number;
  /** The 'boss' stream: the drift heading and whatever an attack draws. */
  readonly rng: Rng;
  /** Multiplier for the speed of rocks an attack launches. */
  readonly rockSpeed: number;
  readonly field: Field;
}

/** How far inside the field's edges a ship respawns clear of a boss. */
export const RESPAWN_INSET = 60;

/**
 * Where a ship can respawn at least `clearance` from a core at `core`: bottom-centre, a little inside the edge, or if
 * the core has drifted too near it, the inset corner farthest from the core.
 */
export function clearSpot(core: Readonly<{ x: number; y: number }>, clearance: number, field: Field): { x: number; y: number } {
  const [left, right, top, bottom] = [RESPAWN_INSET, field.width - RESPAWN_INSET, RESPAWN_INSET, field.height - RESPAWN_INSET];
  const spot = { x: field.width / 2, y: bottom };
  if (Math.hypot(spot.x - core.x, spot.y - core.y) >= clearance) return spot;
  spot.x = Math.abs(core.x - left) > Math.abs(core.x - right) ? left : right;
  spot.y = Math.abs(core.y - top) > Math.abs(core.y - bottom) ? top : bottom;
  return spot;
}

/** Where a boss arrives in `field`. */
export function bossHome(field: Field): { readonly x: number; readonly y: number } {
  return { x: field.width / 2, y: field.height * HOME_HEIGHT_SHARE };
}

function phaseFor(hp: number, maxHp: number): BossPhase {
  if (hp * 3 <= maxHp) return 3;
  return hp * 3 <= maxHp * 2 ? 2 : 1;
}

/** Where a shot does harm now: the core if it can be hurt, else a live part, and nowhere outside the fight. */
export function bossTarget(view: Readonly<BossView>): Readonly<{ x: number; y: number }> | null {
  if (view.state !== 'fighting') return null;
  if (view.vulnerable) return view;
  for (const part of view.parts) if (part.hp > 0) return part;
  return null;
}

function assertAttacks(def: BossDef, behaviour: BossBehaviour): void {
  def.phases.forEach((list, i) => {
    for (const id of list) {
      if (behaviour.attacks[id] === undefined) throw new RangeError(`${def.id}'s phase ${String(i + 1)} names attack ${id}, which its behaviour lacks: add ${id} to the behaviour's attacks, or drop it from the phase`);
    }
  });
  for (const [id, spec] of Object.entries(behaviour.attacks)) {
    if (!(spec.windup >= MIN_WINDUP_SECONDS)) {
      throw new RangeError(`attack ${id} has a windup of ${String(spec.windup)} s, under the ${String(MIN_WINDUP_SECONDS)} s minimum: give it a telegraph of at least ${String(MIN_WINDUP_SECONDS)} s`);
    }
  }
}

function assertDamage(damage: number): void {
  if (!(damage > 0 && Number.isFinite(damage))) {
    throw new RangeError(`boss damage must be a positive finite damage (got ${String(damage)}): pass 1 for a shot`);
  }
}

/**
 * A phased boss fight: a 2 s intro, then rests and attacks (each a telegraphed windup, then its active time)
 * through three phases, then 2 s of dying, announced with `bossDown` as it starts. It cannot be hurt in the intro or
 * dying, nor while its behaviour shields its core: the step that changes that announces `bossExposed` or
 * `bossShielded`. Its parts, if it has any, are struck one by one. Everything it does is driven by `step` and its
 * seeded stream, so a fight replays exactly.
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
  /** The vulnerability last announced, with `bossExposed` or `bossShielded`. */
  private shownVulnerable: boolean;

  constructor(
    private readonly def: BossDef,
    private readonly behaviour: BossBehaviour,
    private readonly setup: BossSetup,
  ) {
    assertAttacks(def, behaviour);
    const home = bossHome(setup.field);
    this.view = {
      id: def.id,
      x: home.x,
      y: home.y,
      px: home.x,
      py: home.y,
      radius: def.radius,
      hp: setup.maxHp,
      maxHp: setup.maxHp,
      phase: 1,
      state: 'intro',
      windup: null,
      active: null,
      vulnerable: true,
      parts: behaviour.parts ?? [],
    };
    const heading = setup.rng.range(0, TAU);
    this.dx = Math.cos(heading) * behaviour.driftSpeed;
    this.dy = Math.sin(heading) * behaviour.driftSpeed;
    this.shownVulnerable = this.refreshVulnerable();
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

  /** How far from the core's centre the boss reaches, its parts included. */
  get reach(): number {
    return this.behaviour.reach ?? this.view.radius;
  }

  /** Stretches the core, its parts and the points an attack under way aims at, to the new field like every other entity. */
  resize(old: Field, field: Field): void {
    const { view, context } = this;
    for (const body of [view, ...view.parts]) {
      body.x = rescale(body.x, old.width, field.width);
      body.px = rescale(body.px, old.width, field.width);
      body.y = rescale(body.y, old.height, field.height);
      body.py = rescale(body.py, old.height, field.height);
    }
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

  /** The index of the first live part a circle at (x, y) overlaps, or -1. */
  partAt(x: number, y: number, radius: number): number {
    const { parts } = this.view;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as BossPart;
      if (part.hp > 0 && circlesOverlap(part.x, part.y, part.radius, x, y, radius)) return i;
    }
    return -1;
  }

  /** True when a circle at (x, y) overlaps the core or a live part. */
  touches(x: number, y: number, radius: number): boolean {
    return this.overlaps(x, y, radius) || this.partAt(x, y, radius) >= 0;
  }

  /**
   * Takes `damage` off its HP and returns what came of it: 'blocked' outside the fight (intro, dying, down),
   * 'deflected' while its core is shielded, 'killed' for the blow that empties it. Phase changes are announced by the
   * next `step`.
   */
  hit(damage: number): HitResult {
    assertDamage(damage);
    const view = this.view;
    if (view.state !== 'fighting') return 'blocked';
    if (!view.vulnerable) return 'deflected';
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

  /**
   * Takes `damage` off part `index`, which must be live, and returns what came of it: 'blocked' outside the fight,
   * 'broken' for the blow that empties it. A break that exposes the core takes effect at once; the next `step` announces it.
   */
  hitPart(index: number, damage: number): PartHitResult {
    assertDamage(damage);
    const part = this.view.parts[index];
    if (part === undefined || part.hp <= 0) throw new RangeError(`no live part ${String(index)} to hit: pass an index from partAt`);
    if (this.view.state !== 'fighting') return 'blocked';
    part.hp = Math.max(0, part.hp - damage);
    if (part.hp > 0) return 'hit';
    this.refreshVulnerable();
    return 'broken';
  }

  /** Applies, on the hazard path, the shove the last attack asked for, then forgets it; a boss beaten meanwhile shoves nothing. */
  shove(ship: Moving): void {
    const ctx = this.context;
    if (ctx === null || (ctx.shoveX === 0 && ctx.shoveY === 0)) return;
    if (this.view.state === 'fighting') nudge(ship, ctx.shoveX, ctx.shoveY, MAX_SHOVE_SPEED);
    ctx.shoveX = 0;
    ctx.shoveY = 0;
  }

  /** Advances the fight by `dt` seconds, pushing its events into `arena.events` and any rocks into `arena.asteroids`. */
  step(dt: number, arena: Arena): void {
    const view = this.view;
    view.px = view.x;
    view.py = view.y;
    for (const part of view.parts) {
      part.px = part.x;
      part.py = part.y;
    }
    while (this.announced < view.phase) {
      this.announced = (this.announced + 1) as BossPhase;
      arena.events.push({ type: 'bossPhase', phase: this.announced as 2 | 3 });
    }
    const ctx = this.contextFor(arena);
    ctx.dt = dt;
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
    if (view.state === 'down') return;
    this.behaviour.step?.(ctx);
    this.announceVulnerability(arena);
  }

  /** Asks the behaviour whether the core can be hurt now, and shows the answer on the view. */
  private refreshVulnerable(): boolean {
    const view = this.view;
    view.vulnerable = this.behaviour.vulnerable?.(view) ?? true;
    return view.vulnerable;
  }

  /** Announces the core being exposed or shielded again since the last announcement, while it fights. */
  private announceVulnerability(arena: Arena): void {
    const view = this.view;
    if (this.refreshVulnerable() === this.shownVulnerable || view.state !== 'fighting') return;
    this.shownVulnerable = view.vulnerable;
    arena.events.push({ type: view.vulnerable ? 'bossExposed' : 'bossShielded', x: view.x, y: view.y });
  }

  private spec(id: AttackId): AttackSpec {
    const spec = this.behaviour.attacks[id];
    if (spec === undefined) throw new RangeError(`${this.def.id} has no attack ${id}: add it to the behaviour's attacks`);
    return spec;
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
    this.view.active = null;
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
    } else if (this.reached(this.spec(this.attackId).windup)) {
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
    view.active = view.windup;
    view.windup = null;
    const ctx = this.contextFor(arena);
    ctx.fromX = view.x;
    ctx.fromY = view.y;
  }

  private runAttack(id: AttackId, dt: number, arena: Arena): void {
    const spec = this.spec(id);
    const ctx = this.contextFor(arena);
    ctx.age = this.clock;
    spec.run(ctx);
    this.clock += dt;
    if (this.reached(spec.active)) this.rest();
  }

  private contextFor(arena: Arena): AttackContext {
    this.context ??= { arena, rng: this.setup.rng, rockSpeed: this.setup.rockSpeed, boss: this.view, dt: 0, age: 0, aimX: 0, aimY: 0, fromX: 0, fromY: 0, shoveX: 0, shoveY: 0 };
    this.context.arena = arena;
    return this.context;
  }

  /** Moves the core along its heading, bouncing it off the walls so the whole boss, parts and all, stays inside the field. */
  private drift(dt: number, field: Field): void {
    const { view } = this;
    const { reach } = this;
    const [maxX, maxY] = [field.width - reach, field.height - reach];
    view.x = clamp(view.x + this.dx * dt, reach, maxX);
    view.y = clamp(view.y + this.dy * dt, reach, maxY);
    if (view.x === reach) this.dx = Math.abs(this.dx);
    else if (view.x === maxX) this.dx = -Math.abs(this.dx);
    if (view.y === reach) this.dy = Math.abs(this.dy);
    else if (view.y === maxY) this.dy = -Math.abs(this.dy);
  }
}
