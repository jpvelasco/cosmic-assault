import type { BossDef } from '../../content/bosses';
import { clamp } from '../../content/curves';
import { BOSS_INTRO_SECONDS } from '../../content/pacingRules';
import type { AttackId } from '../../content/types';
import { circlesOverlap } from '../collision';
import type { Field } from '../field';
import { nudge, TAU, TIME_EPSILON, type Moving } from '../math';
import type { Arena } from '../rules';
import { rescale, rescalePose } from '../wrap';
import type { AttackContext, AttackSpec, BossBehaviour, BossPart, BossPhase, BossSetup, BossState, BossView, Exposure, Point } from './behaviour';

/** The shortest telegraph an attack may have: players need this long to see it coming. */
export const MIN_WINDUP_SECONDS = 0.35;
/** How long a beaten boss takes to die; the renderer fades it over this. */
export const DYING_SECONDS = 2;
/** Where a boss arrives, as a share of the field height from the top. */
const HOME_HEIGHT_SHARE = 0.28;
/** The most speed a boss's shove leaves the ship with, in units per second; a ship already faster only keeps from gaining. */
export const MAX_SHOVE_SPEED = 300;

/** What a blow on the core did: nothing outside the fight ('blocked') or while it is shielded ('deflected'). */
export type HitResult = 'blocked' | 'deflected' | 'hit' | 'killed';
/** What a blow on a part did: nothing outside the fight ('blocked'), or it took HP off the part, perhaps the last. */
export type PartHitResult = 'blocked' | 'hit' | 'broken';

/** How far inside the field's edges a ship respawns clear of a boss. */
export const RESPAWN_INSET = 60;
/**
 * The lowest a ship respawns in a boss galaxy, as a share of the field height: above the band the HUD's boss bar sits
 * in along the bottom (render/hud.ts), on every screen.
 */
export const RESPAWN_LOWEST_SHARE = 0.8;

/**
 * Where a ship can respawn at least `clearance` from a core at `core`: low in the middle, at `RESPAWN_LOWEST_SHARE` of
 * the height, or if the core has drifted too near it, the corner farthest from the core, as low or as near the top.
 */
export function clearSpot(core: Readonly<Point>, clearance: number, field: Field): Point {
  const [left, right, top, bottom] = [RESPAWN_INSET, field.width - RESPAWN_INSET, RESPAWN_INSET, field.height * RESPAWN_LOWEST_SHARE];
  const spot = { x: field.width / 2, y: bottom };
  if (Math.hypot(spot.x - core.x, spot.y - core.y) >= clearance) return spot;
  spot.x = Math.abs(core.x - left) > Math.abs(core.x - right) ? left : right;
  spot.y = Math.abs(core.y - top) > Math.abs(core.y - bottom) ? top : bottom;
  return spot;
}

/** Where a boss arrives in `field`. */
export function bossHome(field: Field): Readonly<Point> {
  return { x: field.width / 2, y: field.height * HOME_HEIGHT_SHARE };
}

function phaseFor(hp: number, maxHp: number): BossPhase {
  if (hp * 3 <= maxHp) return 3;
  return hp * 3 <= maxHp * 2 ? 2 : 1;
}

/** Where a shot does harm now: wherever the boss's behaviour says, by default the core if it can be hurt, else a live part; nowhere outside the fight. */
export function bossTarget(view: Readonly<BossView>): Readonly<Point> | null {
  return view.state === 'fighting' ? view.target : null;
}

/** Where a shot harms a boss whose behaviour does not say: the core if it can be hurt, else its first live part. */
function coreOrPart(view: Readonly<BossView>): Readonly<Point> | null {
  if (view.vulnerable) return view;
  for (const part of view.parts) if (part.hp > 0) return part;
  return null;
}

/** How a boss announces its core opening and closing, unless its behaviour says otherwise. */
const CORE_EXPOSURE: Exposure = { opened: 'bossExposed', closed: 'bossShielded' };
/** Where a boss faces until its behaviour turns it: down the field, toward the ship's side. */
const FACING_DOWN = Math.PI / 2;

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
    const home = behaviour.home?.(setup.field) ?? bossHome(setup.field);
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
      facing: FACING_DOWN,
      target: null,
    };
    const heading = setup.rng.range(0, TAU);
    this.dx = Math.cos(heading) * behaviour.driftSpeed;
    this.dy = Math.sin(heading) * behaviour.driftSpeed;
    this.shownVulnerable = this.refresh();
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

  /** Stretches the core, its parts, its target and the points an attack under way aims at, to the new field like every other entity. */
  resize(old: Field, field: Field): void {
    const { view, context } = this;
    for (const body of [view, ...view.parts]) rescalePose(body, old, field);
    this.refresh();
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
   * Takes `damage` off its HP for a blow landing at (x, y), the core's centre if not given, and returns what came of it:
   * 'blocked' outside the fight (intro, dying, down), 'deflected' while its core is shielded or off its weak point,
   * 'killed' for the blow that empties it. Phase changes are announced by the next `step`.
   */
  hit(damage: number, x = this.view.x, y = this.view.y): HitResult {
    assertDamage(damage);
    const view = this.view;
    if (view.state !== 'fighting') return 'blocked';
    if (!view.vulnerable || this.behaviour.hurtsAt?.(view, x, y) === false) return 'deflected';
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
    this.refresh();
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

  /** Asks the behaviour whether the core can be hurt now and where a shot does harm, shows both on the view, and returns the first. */
  private refresh(): boolean {
    const { view, behaviour } = this;
    view.vulnerable = behaviour.vulnerable?.(view) ?? true;
    view.target = behaviour.target === undefined ? coreOrPart(view) : behaviour.target(view);
    return view.vulnerable;
  }

  /** Announces the core being exposed or shielded again since the last announcement, while it fights, as its behaviour names it. */
  private announceVulnerability(arena: Arena): void {
    const view = this.view;
    if (this.refresh() === this.shownVulnerable || view.state !== 'fighting') return;
    this.shownVulnerable = view.vulnerable;
    const { opened, closed } = this.behaviour.exposure ?? CORE_EXPOSURE;
    arena.events.push({ type: view.vulnerable ? opened : closed, x: view.x, y: view.y });
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
