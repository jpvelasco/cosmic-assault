import { GUNSHIP, MINE } from '../../src/content/foes';
import { HAZARD_RULES } from '../../src/content/hazards';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { AttackId, FoeKind, HazardType } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';
import type { BossView } from '../../src/sim/boss/behaviour';

/** An event, with the galaxy seconds of the step that made it. */
export interface TimedEvent {
  readonly elapsed: number;
  readonly event: SimEvent;
}

/** A hostile activation and the warning it was paired with by id. */
export interface TelegraphPair {
  readonly id: number;
  readonly kind: HazardType;
  readonly warned: number;
  readonly active: number;
  /** The seconds its rule says the warning must run. */
  readonly minimum: number;
}

/** Float residue from summing fixed steps. */
const SLACK = 1e-6;

/** The event that warns of a hazard and the one that turns it hostile, which carry the same id and the hazard's type as `kind`. */
export interface HazardTelegraph {
  readonly warning: SimEvent['type'];
  readonly start: SimEvent['type'];
}

/**
 * Every hazard type's telegraph events. A test fails while a hazard in `HAZARD_FACTORIES` has no entry here, so a new
 * hazard cannot slip past the audit. Boss attacks have their own entries, `ATTACK_TELEGRAPHS`, and foe attacks
 * theirs, `FOE_TELEGRAPHS`.
 */
export const HAZARD_TELEGRAPHS: Readonly<Partial<Record<HazardType, HazardTelegraph>>> = {
  gravityWell: { warning: 'wellWarning', start: 'wellStart' },
  repulsionField: { warning: 'wellWarning', start: 'wellStart' },
  dangerZone: { warning: 'zoneWarning', start: 'zoneStart' },
};

const AUDITED = Object.entries(HAZARD_TELEGRAPHS) as [HazardType, HazardTelegraph][];

/**
 * The hazard type `event` turns hostile, with its telegraph's events, or null for an event that turns nothing hostile.
 * Hazards that share their events (the force fields) tell them apart by `kind`; a zone's events are its own.
 */
function activation(event: SimEvent): { readonly type: HazardType; readonly telegraph: HazardTelegraph } | null {
  const kind = 'kind' in event ? event.kind : undefined;
  for (const [type, telegraph] of AUDITED) if (telegraph.start === event.type && (kind ?? type) === type) return { type, telegraph };
  return null;
}

const idOf = (event: SimEvent): number | null => ('id' in event && typeof event.id === 'number' ? event.id : null);
const key = (type: SimEvent['type'], id: number): string => `${type}#${String(id)}`;
/** Seconds to the millisecond, without trailing zeros. */
const seconds = (value: number): string => `${String(Number(value.toFixed(3)))} s`;

/**
 * Pairs each hostile activation in `log` with its warning by id, and checks the warning ran at least its rule's
 * minimum before it. Returns the pairs, in the order the activations came; throws, naming the hazard, when an
 * activation was never warned or was warned too late.
 */
export function auditTelegraphs(log: readonly TimedEvent[]): TelegraphPair[] {
  const warned = new Map<string, number>();
  const pairs: TelegraphPair[] = [];
  for (const { elapsed, event } of log) {
    const id = idOf(event);
    if (id !== null) warned.set(key(event.type, id), elapsed);
    const hostile = activation(event);
    if (hostile === null || id === null) continue;
    const { type: kind, telegraph } = hostile;
    const minimum = HAZARD_RULES[kind].telegraph;
    const at = warned.get(key(telegraph.warning, id));
    if (at === undefined) throw new Error(`${kind} ${String(id)} turned hostile at ${seconds(elapsed)} with no warning: push its ${telegraph.warning} first`);
    if (elapsed - at + SLACK < minimum) {
      throw new Error(`${kind} ${String(id)} turned hostile ${seconds(elapsed - at)} after its warning, under its ${seconds(minimum)} telegraph: warn earlier or start later`);
    }
    pairs.push({ id, kind, warned: at, active: elapsed, minimum });
  }
  return pairs;
}

/**
 * What a boss attack's harm leaves to see: the rocks, foes or bolts it sends out, each tagged `fromAttack` as it is made,
 * or, for an attack that only moves the boss or shoves the ship, its own active time.
 */
export type AttackHarm = 'rocks' | 'foes' | 'bolts' | 'active';

/**
 * Every boss attack's harm, keyed by attack. Each is warned by its `bossWindup` and may harm no sooner than
 * `MIN_WINDUP_SECONDS` after it. The record is total over `AttackId`, so a new attack cannot slip past the audit.
 */
export const ATTACK_TELEGRAPHS: Readonly<Record<AttackId, AttackHarm>> = {
  shardRing: 'rocks',
  lunge: 'active',
  shardVolley: 'active',
  quake: 'rocks',
  pulse: 'active',
  launch: 'foes',
  broadside: 'rocks',
  retreat: 'active',
};

/**
 * What one step of a boss fight showed: its events, the attack running after it, the declared windup of the attack
 * winding up or running (null between attacks), and the attack-made bodies new in it.
 */
export interface FightStep {
  readonly elapsed: number;
  readonly events: readonly SimEvent[];
  readonly active: AttackId | null;
  readonly windup?: number | null;
  readonly made: Readonly<Record<Exclude<AttackHarm, 'active'>, number>>;
}

/** What the recorder reads of a fight after each step: a World, or a runner on a stub arena. */
export interface FightSource {
  readonly elapsed: number;
  readonly boss: Readonly<BossView> | null;
  readonly asteroids: readonly Readonly<{ id: number; fromAttack?: boolean }>[];
  readonly foes: readonly Readonly<{ id: number; fromAttack?: boolean }>[];
  readonly bolts: readonly Readonly<{ id: number; fromAttack?: boolean }>[];
}

/** One attack, from its warning: the windup it must run, when it went active, and what harm it was seen to do. */
export interface AttackPair {
  readonly attack: AttackId;
  readonly warned: number;
  /** Its declared windup, or `MIN_WINDUP_SECONDS` if the step showed none; never less than the minimum. */
  readonly minimum: number;
  active: number | null;
  readonly harm: Set<AttackHarm>;
}

/** Records each step of a boss fight for `auditAttacks`: call it after every step. */
export function fightRecorder(): { readonly steps: FightStep[]; record(fight: FightSource, events: readonly SimEvent[]): void } {
  const seen = new Set<number>();
  const steps: FightStep[] = [];
  const fresh = (bodies: readonly Readonly<{ id: number; fromAttack?: boolean }>[]): number => {
    let count = 0;
    for (const body of bodies) {
      if (body.fromAttack !== true || seen.has(body.id)) continue;
      seen.add(body.id);
      count++;
    }
    return count;
  };
  return {
    steps,
    record(fight, events) {
      const { boss } = fight;
      steps.push({
        elapsed: fight.elapsed,
        events: events.map((e) => ({ ...e })),
        active: boss?.active ?? null,
        windup: boss?.threat?.windup ?? null,
        made: { rocks: fresh(fight.asteroids), foes: fresh(fight.foes), bolts: fresh(fight.bolts) },
      });
    },
  };
}

/**
 * Pairs each boss attack with its `bossWindup`, and checks it went active, and that every rock, foe and bolt it made
 * appeared, no sooner than its own declared windup after the warning (and never under `MIN_WINDUP_SECONDS`), and that
 * it made only the harm `harms` names for it. Returns the attacks in the order they were warned; throws, naming the
 * attack, at the first that breaks the rule.
 */
export function auditAttacks(steps: readonly FightStep[], harms: Readonly<Record<AttackId, AttackHarm>> = ATTACK_TELEGRAPHS): AttackPair[] {
  const pairs: AttackPair[] = [];
  let current: AttackPair | null = null;
  const early = (pair: AttackPair, elapsed: number, what: string): Error =>
    new Error(`${pair.attack} warned at ${seconds(pair.warned)} ${what} at ${seconds(elapsed)}, under its ${seconds(pair.minimum)} windup: lengthen its windup, or make nothing before it ends`);
  for (const { elapsed, events, active, windup, made } of steps) {
    for (const event of events) {
      if (event.type !== 'bossWindup') continue;
      current = { attack: event.attack, warned: elapsed, minimum: Math.max(MIN_WINDUP_SECONDS, windup ?? 0), active: null, harm: new Set() };
      pairs.push(current);
    }
    if (current !== null && active === current.attack && current.active === null) {
      if (elapsed - current.warned + SLACK < current.minimum) throw early(current, elapsed, 'went active');
      current.active = elapsed;
      if (harms[current.attack] === 'active') current.harm.add('active');
    }
    for (const kind of ['rocks', 'foes', 'bolts'] as const) {
      if (made[kind] === 0) continue;
      if (current === null) throw new Error(`${String(made[kind])} attack ${kind} appeared at ${seconds(elapsed)} with no attack warned: tag only what an attack makes`);
      if (elapsed - current.warned + SLACK < current.minimum) throw early(current, elapsed, `made ${kind}`);
      if (harms[current.attack] !== kind) throw new Error(`${current.attack} made ${kind}, which its telegraph entry does not name: fix ATTACK_TELEGRAPHS`);
      current.harm.add(kind);
    }
  }
  return pairs;
}

/** A foe's telegraphed attack: the event that warns of it and the one that does its harm, and the windup between them. */
export interface FoeTelegraph {
  readonly warning: SimEvent['type'];
  readonly harm: SimEvent['type'];
  /** Seconds the warning must run first: its declared windup, never under `MIN_WINDUP_SECONDS`. */
  readonly minimum: number;
}

/**
 * Every foe kind's telegraphed attack, or null for a kind with none. The record is total over `FoeKind`, so a new foe
 * cannot slip past the audit: a gunship's windup before its bolt, a mine's arming before its blast.
 */
export const FOE_TELEGRAPHS: Readonly<Record<FoeKind, FoeTelegraph | null>> = {
  splitter: null,
  drone: null,
  gunship: { warning: 'foeWindup', harm: 'boltFired', minimum: Math.max(MIN_WINDUP_SECONDS, GUNSHIP.windup) },
  mine: { warning: 'mineArmed', harm: 'mineBlast', minimum: Math.max(MIN_WINDUP_SECONDS, MINE.fuse) },
};

/** A foe's harm and the warning it was paired with by the foe's id. */
export interface FoeAttackPair {
  readonly kind: FoeKind;
  readonly foe: number;
  readonly warned: number;
  readonly harmed: number;
  readonly minimum: number;
}

/** The foe a harm event comes from, by its kind and id, or null for an event that is no foe's harm. */
function foeHarm(event: SimEvent): { readonly kind: FoeKind; readonly foe: number } | null {
  if (event.type === 'boltFired') return event.source === 'boss' ? null : { kind: event.source, foe: event.owner };
  if (event.type === 'mineBlast') return { kind: 'mine', foe: event.id };
  return null;
}

/**
 * Pairs each foe's harm (a gunship's bolt, a mine's blast) with that foe's latest warning, which it spends, and checks
 * the warning ran at least the attack's minimum before it. Returns the pairs in the order the harms came; throws,
 * naming the foe, at a harm never warned, warned too late, or by a kind `FOE_TELEGRAPHS` gives none.
 */
export function auditFoeAttacks(log: readonly TimedEvent[]): FoeAttackPair[] {
  const warned = new Map<string, number>();
  const pairs: FoeAttackPair[] = [];
  for (const { elapsed, event } of log) {
    for (const [kind, telegraph] of Object.entries(FOE_TELEGRAPHS) as [FoeKind, FoeTelegraph | null][]) {
      if (telegraph?.warning === event.type && 'id' in event) warned.set(`${kind}#${String(event.id)}`, elapsed);
    }
    const harm = foeHarm(event);
    if (harm === null) continue;
    const telegraph = FOE_TELEGRAPHS[harm.kind];
    if (telegraph === null) throw new Error(`a ${harm.kind} made ${event.type} at ${seconds(elapsed)}, but FOE_TELEGRAPHS gives it no telegraph: add one`);
    const at = warned.get(`${harm.kind}#${String(harm.foe)}`);
    if (at === undefined) throw new Error(`${harm.kind} ${String(harm.foe)} made ${event.type} at ${seconds(elapsed)} with no ${telegraph.warning}: warn first`);
    if (elapsed - at + SLACK < telegraph.minimum) {
      throw new Error(`${harm.kind} ${String(harm.foe)} made ${event.type} ${seconds(elapsed - at)} after its ${telegraph.warning}, under its ${seconds(telegraph.minimum)} windup: lengthen it`);
    }
    warned.delete(`${harm.kind}#${String(harm.foe)}`);
    pairs.push({ kind: harm.kind, foe: harm.foe, warned: at, harmed: elapsed, minimum: telegraph.minimum });
  }
  return pairs;
}
