import type { AttackId, BossId, FoeKind } from '../../content/types';
import type { SimEvent } from '../events';
import type { Field } from '../field';
import type { Bolts } from '../foes/bolts';
import type { Rng } from '../rng';
import type { Arena } from '../rules';

export type BossState = 'intro' | 'fighting' | 'dying' | 'down';
export type BossPhase = 1 | 2 | 3;

export interface Point {
  x: number;
  y: number;
}

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
  /** True while its behaviour armours it, so a blow on it is deflected; set by the runner with the view's target. */
  armoured?: boolean;
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
  /** The bearing it faces, in radians: down the field, unless its behaviour turns it. */
  facing: number;
  /** Where a shot does harm now, or null if nowhere does; refreshed after every step, part broken and resize. Read it through `bossTarget`. */
  target: Readonly<Point> | null;
  /** The attack winding up or running, as the bots read it, else null; the same object each time that attack comes round. */
  threat: Readonly<BossThreat> | null;
  /**
   * Where the latest windup aims, set as it begins: where the ship was then, or where the attack's own `aim` moves that
   * to. An attack aimed at the ship fires, dashes or coils at it, and the bots read it; one point, moved in place.
   */
  readonly aim: Point;
}

/** What an attack sees and may change. Refilled in place every step. */
export interface AttackContext {
  arena: Arena;
  readonly rng: Rng;
  readonly rockSpeed: number;
  /** The galaxy's hostile bolts, for an attack that fires them; null where there are none to fire. */
  readonly bolts: Bolts | null;
  /** The boss; an attack may move its core. */
  readonly boss: BossView;
  /** This step's length. */
  dt: number;
  /** Seconds since the attack went active, before this step. */
  age: number;
  /**
   * Where the core was when the attack went active, as the runner read it after its drift. A behaviour that owns its
   * core's pose, and so overrides that drift, may set it again from its own step on the attack's first active step,
   * before the attack's run first reads it.
   */
  fromX: number;
  fromY: number;
  /**
   * A change to the ship's velocity an attack asks for, in units per second. The runner applies it on the next step's
   * hazard path, capped at `MAX_SHOVE_SPEED`, and zeroes it.
   */
  shoveX: number;
  shoveY: number;
}

/**
 * How an attack threatens the ship beyond the rocks, foes and bolts it sends out, which carry `fromAttack` once made, or
 * where what it will send out flies, declared for its windup: data, so a bot reads any boss's attack without knowing
 * the boss.
 */
export type AttackThreat =
  /**
   * It sends the core, or its parts, down the lane from the core to the windup's aim (`BossView.aim`), or fires bolts
   * that converge on that point, reaching `reach` either side of that line; 'core' reaches the core's radius.
   */
  | { readonly kind: 'lane'; readonly reach: number | 'core' }
  /** As it goes active it shoves the ship straight away from the core, `speed` at the core's rim and fading to none `reach` beyond it: `radialShove`. */
  | { readonly kind: 'shove'; readonly speed: number; readonly reach: number }
  /**
   * It sweeps a ring of `radius` about the core, or about the windup's aim (`BossView.aim`), reaching `reach` either
   * side of the ring: a ring of parts easing out, a body coiling round the ship.
   */
  | { readonly kind: 'ring'; readonly radius: number; readonly reach: number; readonly around: RingCentre };

/** What a ring threat is centred on: the core, or the windup's aim. */
export type RingCentre = 'core' | 'aim';

/** An attack as the bots read it: its windup, in the boss's time, and its threat resolved for the boss that makes it. */
export interface BossThreat {
  readonly attack: AttackId;
  readonly windup: number;
  /** 'none' for an attack whose only harm is what it sends out. */
  readonly kind: AttackThreat['kind'] | 'none';
  /** How far either side of its lane or ring, or past the core's rim, it reaches; 0 for none. */
  readonly reach: number;
  /** A shove's speed at the core's rim; 0 for any other. */
  readonly speed: number;
  /** A ring's radius and centre; absent for any other. */
  readonly ring?: Readonly<{ radius: number; around: RingCentre }>;
}

export interface AttackSpec {
  /** Seconds of telegraph, at least `MIN_WINDUP_SECONDS`. The attack does nothing until it ends. */
  readonly windup: number;
  /** Seconds the attack runs for; 0 runs it once. */
  readonly active: number;
  /**
   * Writes into `out` where the attack aims for a ship at `ship` as its windup begins, in `field`; where the ship is, if
   * absent. Pure and drawing nothing: a dash keeps its aim where the core fits, a coil moves its ring onto the field.
   */
  aim?(ship: Readonly<Point>, field: Field, out: Point): void;
  /** Called every step of the active time. */
  run(ctx: AttackContext): void;
  /** How it threatens the ship beyond what it sends out; nothing more, if absent. */
  readonly threat?: AttackThreat;
}

/** The events announcing a boss's core open to harm and closed to it again. */
export interface Exposure {
  readonly opened: Extract<SimEvent['type'], 'bossExposed' | 'hangarOpen'>;
  readonly closed: Extract<SimEvent['type'], 'bossShielded' | 'hangarClose'>;
}

/** How a boss acts: the attacks its definition names, and how fast its core drifts between them. */
export interface BossBehaviour {
  /** At least every attack its definition's phases name. */
  readonly attacks: Readonly<Partial<Record<AttackId, AttackSpec>>>;
  /** px per second; 0 for a boss that moves itself, or not at all. */
  readonly driftSpeed: number;
  /** Its parts, which the runner shows on the view, steps the previous poses of, rescales and strikes. None if absent. */
  readonly parts?: readonly BossPart[];
  /**
   * How far the core keeps from the walls as it drifts, and from a respawning ship; the core radius if absent. A
   * respawning ship also keeps clear of every live part by the part's own radius, wherever it is.
   */
  readonly reach?: number;
  /**
   * True for parts that move rigidly with the core, an orbit or a ring say: the drift then keeps every live part inside
   * the field too, beyond `reach`. False if absent: a boss whose parts trail behind it, a serpent's body say, keeps
   * them inside the field itself, since moving the core does not move them with it.
   */
  readonly rigidParts?: boolean;
  /** Where in `field` it arrives; `bossHome` if absent. */
  home?(field: Field): Readonly<Point>;
  /** The events announcing its core exposed and shielded again; `bossExposed` and `bossShielded` if absent. */
  readonly exposure?: Exposure;
  /** Runs at the end of every step until the boss is down, after its core has drifted or attacked: it moves its parts, say. */
  step?(ctx: AttackContext): void;
  /** Whether a blow on the core can hurt it now; always, if absent. Asked after every step and every part broken. */
  vulnerable?(boss: Readonly<BossView>): boolean;
  /**
   * Whether a blow on part `index` hurts it now; always, if absent. An armoured part deflects the blow, which spends a
   * shot. Asked for every hit on a part, and after every step and every part broken.
   */
  partVulnerable?(index: number): boolean;
  /** Whether a blow landing at (x, y) hurts the core while it can be hurt; anywhere does, if absent. Elsewhere it deflects. */
  hurtsAt?(boss: Readonly<BossView>, x: number, y: number): boolean;
  /**
   * Where a shot does harm now, or null if nowhere does, asked right after `vulnerable`. If absent, the core while it
   * can be hurt, else its first live part that is not armoured.
   */
  target?(boss: Readonly<BossView>): Readonly<Point> | null;
}

/** The galaxy's foes as a boss sees them: it may launch its own into their pool, and count those still alive. */
export interface BossFoes {
  /** Puts a foe of `kind` on the field at (x, y), heading `heading` at its own speed, as the boss's; false with the pool full. */
  launch(kind: FoeKind, x: number, y: number, heading: number): boolean;
  /** How many of the foes the boss launched are alive. */
  readonly launched: number;
}

export interface BossSetup {
  readonly maxHp: number;
  /** The 'boss' stream: the drift heading and whatever an attack draws. */
  readonly rng: Rng;
  /** Multiplier for the speed of rocks an attack launches. */
  readonly rockSpeed: number;
  readonly field: Field;
  /** The galaxy's foes, for a boss that launches its own; absent where there are none to launch into. */
  readonly foes?: BossFoes;
  /** The galaxy's hostile bolts, for a boss that fires them; absent where there are none to fire. */
  readonly bolts?: Bolts;
}

/** Makes a fight's behaviour, which may keep state of its own, from the fight's setup. */
export type BossFactory = (setup: BossSetup) => BossBehaviour;
