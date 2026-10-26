import { PICKUPS } from '../content/pickups';
import type { PickupId } from '../content/types';
import type { SimEvent } from '../sim/events';

export interface PickupNoticeDeps {
  /** The kinds the player has collected, from the save. */
  readonly seen: () => readonly PickupId[];
  /** Records that the player has collected `kind`. */
  readonly markSeen: (kind: PickupId) => void;
  /** Tells the player something in a toast. */
  readonly notify: (text: string) => void;
}

export interface PickupNotices {
  /** Reads one step's events: a kind's first drop announces it, and collecting it ends its callout for good. */
  handle(events: readonly SimEvent[]): void;
  /** A new run has started: callouts for kinds still unseen can be made again. */
  newRun(): void;
}

/**
 * The first-drop callouts. The sim knows nothing of what the player has seen; this decides from the save: a kind that
 * drops before it has ever been collected is announced once per run, until the player collects one.
 */
export function createPickupNotices({ seen, markSeen, notify }: PickupNoticeDeps): PickupNotices {
  const announced = new Set<PickupId>();
  return {
    handle(events) {
      for (const event of events) {
        if (event.type === 'pickupDropped' && !seen().includes(event.kind) && !announced.has(event.kind)) {
          announced.add(event.kind);
          notify(PICKUPS[event.kind].callout);
        } else if (event.type === 'pickupCollected' && !seen().includes(event.kind)) {
          markSeen(event.kind);
        }
      }
    },
    newRun() {
      announced.clear();
    },
  };
}
