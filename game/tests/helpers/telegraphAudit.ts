import { HAZARD_RULES } from '../../src/content/hazards';
import type { HazardType } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';

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
 * hazard cannot slip past the audit. Foe and boss attacks join when their own audits land.
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
