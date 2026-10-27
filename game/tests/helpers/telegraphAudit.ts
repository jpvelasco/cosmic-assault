import { HAZARD_RULES } from '../../src/content/hazards';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { AttackId, HazardType } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';
import type { World } from '../../src/sim/world';

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
 * hazard cannot slip past the audit. Boss attacks have their own entries, `ATTACK_TELEGRAPHS`; foe attacks join when
 * their own audits land.
 */
export const HAZARD_TELEGRAPHS: Readonly<Partial<Record<HazardType, HazardTelegraph>>> = {
  gravityWell: { warning: 'wellWarning', start: 'wellStart' },
  repulsionField: { warning: 'wellWarning', start: 'wellStart' },
};

const AUDITED = Object.entries(HAZARD_TELEGRAPHS) as [HazardType, HazardTelegraph][];

/** The hazard type `event` turns hostile, with its telegraph's events, or null for an event that turns nothing hostile. */
function activation(event: SimEvent): { readonly type: HazardType; readonly telegraph: HazardTelegraph } | null {
  const kind = 'kind' in event ? event.kind : undefined;
  for (const [type, telegraph] of AUDITED) if (telegraph.start === event.type && kind === type) return { type, telegraph };
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

/** What one step of a boss fight showed: its events, the attack running after it, and the attack-made bodies new in it. */
export interface FightStep {
  readonly elapsed: number;
  readonly events: readonly SimEvent[];
  readonly active: AttackId | null;
  readonly made: Readonly<Record<Exclude<AttackHarm, 'active'>, number>>;
}

/** One attack, from its warning: when it went active, and what harm it was seen to do. */
export interface AttackPair {
  readonly attack: AttackId;
  readonly warned: number;
  active: number | null;
  readonly harm: Set<AttackHarm>;
}

/** Records each step of a World's boss fight for `auditAttacks`: call it after every step. */
export function fightRecorder(): { readonly steps: FightStep[]; record(world: World, events: readonly SimEvent[]): void } {
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
    record(world, events) {
      const bolts = world['run']?.['bolts'].list ?? [];
      steps.push({ elapsed: world.elapsed, events: events.map((e) => ({ ...e })), active: world.boss?.active ?? null, made: { rocks: fresh(world.asteroids), foes: fresh(world.foes), bolts: fresh(bolts) } });
    },
  };
}

/**
 * Pairs each boss attack with its `bossWindup`, and checks it went active, and that every rock, foe and bolt it made
 * appeared, no sooner than `MIN_WINDUP_SECONDS` after the warning, and that it made only the harm its entry names.
 * Returns the attacks in the order they were warned; throws, naming the attack, at the first that breaks the rule.
 */
export function auditAttacks(steps: readonly FightStep[]): AttackPair[] {
  const pairs: AttackPair[] = [];
  let current: AttackPair | null = null;
  const early = (pair: AttackPair, elapsed: number, what: string): Error =>
    new Error(`${pair.attack} warned at ${seconds(pair.warned)} ${what} at ${seconds(elapsed)}, under the ${seconds(MIN_WINDUP_SECONDS)} minimum windup: lengthen its windup`);
  for (const { elapsed, events, active, made } of steps) {
    for (const event of events) {
      if (event.type !== 'bossWindup') continue;
      current = { attack: event.attack, warned: elapsed, active: null, harm: new Set() };
      pairs.push(current);
    }
    if (current !== null && active === current.attack && current.active === null) {
      if (elapsed - current.warned + SLACK < MIN_WINDUP_SECONDS) throw early(current, elapsed, 'went active');
      current.active = elapsed;
      if (ATTACK_TELEGRAPHS[current.attack] === 'active') current.harm.add('active');
    }
    for (const kind of ['rocks', 'foes', 'bolts'] as const) {
      if (made[kind] === 0) continue;
      if (current === null) throw new Error(`${String(made[kind])} attack ${kind} appeared at ${seconds(elapsed)} with no attack warned: tag only what an attack makes`);
      if (elapsed - current.warned + SLACK < MIN_WINDUP_SECONDS) throw early(current, elapsed, `made ${kind}`);
      if (ATTACK_TELEGRAPHS[current.attack] !== kind) throw new Error(`${current.attack} made ${kind}, which its telegraph entry does not name: fix ATTACK_TELEGRAPHS`);
      current.harm.add(kind);
    }
  }
  return pairs;
}
