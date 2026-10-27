import { HAZARD_RULES } from '../../src/content/hazards';
import type { SimEvent } from '../../src/sim/events';

/** An event, with the galaxy seconds of the step that made it. */
export interface TimedEvent {
  readonly elapsed: number;
  readonly event: SimEvent;
}

/** A hostile activation and the warning it was paired with by id. */
export interface TelegraphPair {
  readonly id: number;
  readonly kind: string;
  readonly warned: number;
  readonly active: number;
  /** The seconds its rule says the warning must run. */
  readonly minimum: number;
}

/** Float residue from summing fixed steps. */
const SLACK = 1e-6;

interface Activation {
  /** The type of the event that warned of it, carrying the same id. */
  readonly warning: SimEvent['type'];
  readonly id: number;
  readonly kind: string;
  readonly minimum: number;
}

/**
 * The warning and the telegraph a hostile activation needs, or null for an event that turns nothing hostile. Later
 * tasks add their hostile events here: zones, rifts, the black hole, foe and boss attacks.
 */
function activation(event: SimEvent): Activation | null {
  switch (event.type) {
    case 'wellStart':
      return { warning: 'wellWarning', id: event.id, kind: event.kind, minimum: HAZARD_RULES[event.kind].telegraph };
    default:
      return null;
  }
}

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
    if ('id' in event && typeof event.id === 'number') warned.set(key(event.type, event.id), elapsed);
    const hostile = activation(event);
    if (hostile === null) continue;
    const { warning, id, kind, minimum } = hostile;
    const at = warned.get(key(warning, id));
    if (at === undefined) throw new Error(`${kind} ${String(id)} turned hostile at ${seconds(elapsed)} with no warning: push its ${warning} first`);
    if (elapsed - at + SLACK < minimum) {
      throw new Error(`${kind} ${String(id)} turned hostile ${seconds(elapsed - at)} after its warning, under its ${seconds(minimum)} telegraph: warn earlier or start later`);
    }
    pairs.push({ id, kind, warned: at, active: elapsed, minimum });
  }
  return pairs;
}
