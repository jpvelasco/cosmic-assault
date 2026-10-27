import type { BossDef } from '../../content/bosses';
import { clamp } from '../../content/curves';
import { BOSS_INTRO_SECONDS } from '../../content/pacingRules';
import type { AttackId } from '../../content/types';
import { circlesOverlap } from '../collision';
import type { Field } from '../field';
import { nudge, TAU, TIME_EPSILON, type Moving } from '../math';
import type { Arena } from '../rules';
import { rescale, rescalePose } from '../wrap';
import type { AttackContext, AttackSpec, BossBehaviour, BossPart, BossPhase, BossSetup, BossState, BossThreat, BossView, Exposure } from './behaviour';
import { assertAttacks, assertDamage, bossHome, bossThreat, coreOrPart, MAX_SHOVE_SPEED, phaseFor } from './bossRules';

/** How long a beaten boss takes to die; the renderer fades it over this. */
export const DYING_SECONDS = 2;
/** What a blow on the core did: nothing outside the fight ('blocked') or while it is shielded ('deflected'). */
export type HitResult = 'blocked' | 'deflected' | 'hit' | 'killed';
/** What a blow on a part did: nothing outside the fight ('blocked') or on an armoured part ('deflected'), or it took HP off the part, perhaps the last. */
export type PartHitResult = 'blocked' | 'deflected' | 'hit' | 'broken';

/** A part's extent within this of the reach is the reach: an orbit's float residue, not a part trailing beyond it. */
const REACH_SLACK = 1e-6;

/** `extent`, if it lies beyond `reach` by more than float residue, else `reach`. */
const beyond = (reach: number, extent: number): number => (extent > reach + REACH_SLACK ? extent : reach);

/** The parts a boss whose parts trail behind it widens its drift's clamp by: none. */
const NO_PARTS: readonly BossPart[] = [];

/** How a boss announces its core opening and closing, unless its behaviour says otherwise. */
const CORE_EXPOSURE: Exposure = { opened: 'bossExposed', closed: 'bossShielded' };
/** Where a boss faces until its behaviour turns it: down the field, toward the ship's side. */
const FACING_DOWN = Math.PI / 2;

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
  /** Each attack's threat, resolved once, so showing one on the view allocates nothing. */
  private readonly threats: ReadonlyMap<AttackId, BossThreat>;
  /** How far the boss extends each way from its core, as the drift keeps it inside the field; refilled by `measure`. */
  private readonly extent = { left: 0, right: 0, up: 0, down: 0 };

  constructor(
    private readonly def: BossDef,
    private readonly behaviour: BossBehaviour,
    private readonly setup: BossSetup,
  ) {
    assertAttacks(def, behaviour);
    this.threats = new Map(Object.entries(behaviour.attacks).map(([id, spec]) => [id as AttackId, bossThreat(id as AttackId, spec, def.radius)]));
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
      threat: null,
      aim: { x: home.x, y: home.y },
    };
    this.assertFits(setup.field);
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

  /** How far the core keeps from the walls, and from a respawning ship: its behaviour's reach, else its radius. A respawning ship keeps clear of every live part too. */
  get reach(): number {
    return this.behaviour.reach ?? this.view.radius;
  }

  /** Stretches the core, its parts, its target, the windup's aim and the points an attack under way starts from, to the new field like every other entity. */
  resize(old: Field, field: Field): void {
    const { view, context } = this;
    for (const body of [view, ...view.parts]) rescalePose(body, old, field);
    this.refresh();
    view.aim.x = rescale(view.aim.x, old.width, field.width);
    view.aim.y = rescale(view.aim.y, old.height, field.height);
    if (context === null) return;
    context.aimX = view.aim.x;
    context.aimY = view.aim.y;
    context.fromX = rescale(context.fromX, old.width, field.width);
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
    if (!this.lose(damage, 0)) return 'hit';
    this.enter('dying');
    return 'killed';
  }

  /**
   * Takes `damage` off part `index`, which must be live, and returns what came of it: 'blocked' outside the fight,
   * 'deflected' while its behaviour armours it, 'broken' for the blow that empties it. A break takes the definition's
   * `partBreakDamage` off the core, never its last HP, and one that exposes the core takes effect at once; the next
   * `step` announces either.
   */
  hitPart(index: number, damage: number): PartHitResult {
    assertDamage(damage);
    const part = this.view.parts[index];
    if (part === undefined || part.hp <= 0) throw new RangeError(`no live part ${String(index)} to hit: pass an index from partAt`);
    if (this.view.state !== 'fighting') return 'blocked';
    if (this.behaviour.partVulnerable?.(index) === false) return 'deflected';
    part.hp = Math.max(0, part.hp - damage);
    if (part.hp > 0) return 'hit';
    if (this.def.partBreakDamage !== undefined) this.lose(this.def.partBreakDamage, 1);
    this.refresh();
    return 'broken';
  }

  /** Takes `damage` off the core's HP, leaving it at least `floor`, and moves it on to the phase that leaves it in; true if it is emptied. */
  private lose(damage: number, floor: number): boolean {
    const view = this.view;
    view.hp = Math.max(floor, view.hp - damage);
    if (view.hp === 0) return true;
    const phase = phaseFor(view.hp, view.maxHp);
    if (phase > view.phase) {
      view.phase = phase;
      this.cursor = 0;
    }
    return false;
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
    this.stepBehaviour(ctx, arena);
    this.announceVulnerability(arena);
  }

  /**
   * Runs the behaviour's own step, which may move the boss and its parts but make no attack output: no rocks, bolts,
   * drones or shove, which only an attack's run makes, once its windup is over. Throws if it does.
   */
  private stepBehaviour(ctx: AttackContext, arena: Arena): void {
    const { behaviour } = this;
    if (behaviour.step === undefined) return;
    const made = this.output(arena);
    const { shoveX, shoveY } = ctx;
    behaviour.step(ctx);
    if (this.output(arena) > made || ctx.shoveX !== shoveX || ctx.shoveY !== shoveY) {
      throw new RangeError(`${this.def.id}'s behaviour step made attack output (rocks, bolts, drones or a shove), which no windup telegraphs: make it in an attack's run instead`);
    }
  }

  /** How much attack output is on the field: rocks, bolts and the boss's own drones. */
  private output(arena: Arena): number {
    return arena.asteroids.length + (this.setup.bolts?.list.length ?? 0) + (this.setup.foes?.launched ?? 0);
  }

  /** Asks the behaviour whether the core can be hurt now, which parts it armours and where a shot does harm, shows them on the view, and returns the first. */
  private refresh(): boolean {
    const { view, behaviour } = this;
    view.vulnerable = behaviour.vulnerable?.(view) ?? true;
    const { parts } = view;
    for (let i = 0; i < parts.length; i++) (parts[i] as BossPart).armoured = behaviour.partVulnerable?.(i) === false;
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
    this.view.threat = null;
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
    view.threat = this.threats.get(attack) ?? null;
    const ctx = this.contextFor(arena);
    ctx.aimX = view.aim.x = arena.ship.x;
    ctx.aimY = view.aim.y = arena.ship.y;
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
    this.context ??= { arena, rng: this.setup.rng, rockSpeed: this.setup.rockSpeed, bolts: this.setup.bolts ?? null, boss: this.view, dt: 0, age: 0, aimX: 0, aimY: 0, fromX: 0, fromY: 0, shoveX: 0, shoveY: 0 };
    this.context.arena = arena;
    return this.context;
  }

  /**
   * Measures into `extent` how far the boss extends each way from its core, as the drift keeps it inside the field: its
   * reach, or further where a live part of a boss whose parts move rigidly with its core lies beyond it.
   */
  private measure(): Readonly<BossRunner['extent']> {
    const { view, reach, extent } = this;
    extent.left = extent.right = extent.up = extent.down = reach;
    const parts = this.behaviour.rigidParts === true ? view.parts : NO_PARTS;
    for (const part of parts) {
      if (part.hp <= 0) continue;
      extent.left = beyond(extent.left, view.x - part.x + part.radius);
      extent.right = beyond(extent.right, part.x - view.x + part.radius);
      extent.up = beyond(extent.up, view.y - part.y + part.radius);
      extent.down = beyond(extent.down, part.y - view.y + part.radius);
    }
    return extent;
  }

  /** Throws, naming the boss, if the extent its drift keeps inside the field, as it arrives, is wider or taller than `field`. */
  private assertFits(field: Field): void {
    const { left, right, up, down } = this.measure();
    if (left + right <= field.width && up + down <= field.height) return;
    throw new RangeError(
      `${this.def.id} reaches ${String(Math.round(left + right))} across and ${String(Math.round(up + down))} down from its core, more than its ${String(field.width)}×${String(field.height)} field holds: shrink its reach, its orbit or its parts' radius`,
    );
  }

  /**
   * Moves the core along its heading, bouncing it off the walls so its reach stays inside the field, and with it every
   * live part of a boss whose parts move rigidly with its core.
   */
  private drift(dt: number, field: Field): void {
    const { view } = this;
    const { left, right, up, down } = this.measure();
    const [maxX, maxY] = [field.width - right, field.height - down];
    view.x = clamp(view.x + this.dx * dt, left, maxX);
    view.y = clamp(view.y + this.dy * dt, up, maxY);
    if (view.x === left) this.dx = Math.abs(this.dx);
    else if (view.x === maxX) this.dx = -Math.abs(this.dx);
    if (view.y === up) this.dy = Math.abs(this.dy);
    else if (view.y === maxY) this.dy = -Math.abs(this.dy);
  }
}
