import { vi } from 'vitest';
import type { FlowState, Screen } from '../../src/app/flow';
import { createFlowController } from '../../src/app/flowController';
import { createSaveStore, type StorageEvents } from '../../src/app/saveStore';
import type { GalaxyId } from '../../src/content/types';
import type { SaveData } from '../../src/meta/save';
import { memoryStorage } from './memoryStorage';

/** Storage events that never arrive: a tab with no other tab beside it. */
export const NO_EVENTS: StorageEvents = { addEventListener: () => undefined, removeEventListener: () => undefined };

export interface FlowRigOptions {
  readonly save?: SaveData;
  /** The backing storage; share one between two rigs to model two tabs. A fresh one over `save` by default. */
  readonly storage?: ReturnType<typeof memoryStorage>;
  readonly galaxy?: GalaxyId;
  readonly startLives?: number;
  /** False for a debug run's store, which never writes. */
  readonly writes?: boolean;
  /** The date the flow reads as today until `setToday` changes it. */
  readonly today: string;
}

/**
 * A tab: its own save store over `storage` and its flow controller, recording the runs it starts, the screens it shows
 * and the Rank galaxy it says it plays after each move.
 */
export function flowRig(options: FlowRigOptions) {
  const storage = options.storage ?? memoryStorage(options.save);
  const store = createSaveStore({ storage, events: NO_EVENTS, writes: options.writes ?? true });
  store.load();
  let today = options.today;
  const started: FlowState[] = [];
  const screens: Screen[] = [];
  const live: (number | null)[] = [];
  const notify = vi.fn<(text: string) => void>();
  const flow = createFlowController({
    store,
    overrides: { galaxy: options.galaxy, startLives: options.startLives },
    today: () => today,
    startRun: (state) => started.push(state),
    showScreen: (screen) => screens.push(screen),
    notify,
    liveRun: (runSeq) => live.push(runSeq),
  });
  return {
    flow,
    store,
    storage,
    started,
    screens,
    live,
    notify,
    setToday: (date: string) => {
      today = date;
    },
  };
}
