import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Screen } from '../../src/app/flow';
import { createRunController, LEFT_RUN_NOTICE, RECHECK_MS, type RunControllerDeps } from '../../src/app/runController';
import type { RunOverrides } from '../../src/app/seed';
import type { StorageEvents } from '../../src/app/saveStore';
import { setRankRun } from '../../src/meta/progress';
import { startRank } from '../../src/meta/rankRun';
import { defaultSave, SAVE_KEY, type SaveData } from '../../src/meta/save';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { RingLog } from '../../src/platform/log';
import { createTabPresence, type TabPresence } from '../../src/platform/tabPresence';
import { memoryStorage } from '../helpers/memoryStorage';

const FIELD = { width: 1280, height: 720 };
const NO_EVENTS: StorageEvents = { addEventListener: () => undefined, removeEventListener: () => undefined };
const NONE: RunOverrides = { seed: undefined, startLives: undefined, quality: undefined, galaxy: undefined };

/** A presence where no other tab ever answers, unless `owner` is set: then one owns every run. */
function fakePresence(owner = false): TabPresence {
  return { probe: () => Promise.resolve(owner), own: () => () => undefined, dispose: () => undefined };
}

function setup(overrides: Partial<RunOverrides> = {}, field: RunControllerDeps['field'] = () => FIELD, save?: SaveData, presence = fakePresence()) {
  const storage = memoryStorage(save);
  const refresh = vi.fn();
  const screens: Screen[] = [];
  const onRunStarted = vi.fn();
  const notify = vi.fn<(text: string) => void>();
  const run = createRunController({
    storage,
    overrides: { ...NONE, ...overrides },
    log: new RingLog(),
    events: NO_EVENTS,
    field,
    showScreen: (screen) => screens.push(screen),
    onRunStarted,
    notify,
    onEvents: () => undefined,
    refresh,
    presence,
  });
  return { run, storage, screens, onRunStarted, refresh, notify };
}

describe('createRunController', () => {
  it('loads the save and imports the classic score once, writing only outside debug runs', () => {
    const real = setup();
    expect(real.run.save.classicImported).toBe(true);
    expect(real.storage.items.has(SAVE_KEY)).toBe(true);
    const debug = setup({ seed: 3 });
    expect(debug.run.save.classicImported).toBe(true);
    expect(debug.storage.items.has(SAVE_KEY)).toBe(false);
  });

  it('builds the World for the galaxy and mode the flow starts, then lets the app reset for it', () => {
    const { run, onRunStarted } = setup({ galaxy: '2-3', seed: 9 });
    expect(run.world).toBeNull();
    run.command({ kind: 'start' });
    expect(run.world?.galaxy?.id).toBe('2-3');
    expect(run.world?.lives).toBe(3);
    expect(onRunStarted).toHaveBeenCalledTimes(1);
  });

  it('gives a Rank run its lives', () => {
    const { run } = setup({ galaxy: '1-1', startLives: 5 });
    run.command({ kind: 'start' });
    expect(run.world?.lives).toBe(5);
  });

  it('drops the run when the flow reaches a menu screen, before it shows it', () => {
    const { run, screens } = setup({ galaxy: '1-1' });
    run.command({ kind: 'start' });
    const world = run.world;
    run.pause();
    run.quit();
    expect(screens).toEqual(['playing', 'paused', 'title']);
    expect(run.world).toBeNull();
    expect(world?.status).toBe('gameOver');
  });

  it('stands the run total on the Rank score carried in plus the galaxy score, and on the clear total after it', () => {
    const saved = { ...startRank('2026-10-26'), score: 4000 };
    const { run } = setup({ seed: 2 }, () => FIELD, setRankRun(defaultSave(), saved));
    run.command({ kind: 'resumeRank' });
    const world = run.world;
    if (world === null) throw new Error('Resume must start a run');
    expect(run.runTotal).toBe(4000);
    // Seed 2 keeps the idle ship alive to the warp, so the clear bonus is the galaxy's only score.
    while (run.flow.screen === 'playing') run.step(STEP_SECONDS, NO_CONTROLS);
    expect(run.flow.screen).toBe('results');
    expect(run.runTotal).toBe(run.flow.result?.total);
    expect(run.runTotal).toBe(4000 + world.score);
  });

  it('is the galaxy score in Free play', () => {
    const { run } = setup({ galaxy: '1-1', seed: 2 });
    run.command({ kind: 'start' });
    expect(run.runTotal).toBe(run.world?.score);
  });

  describe('a run saved mid-galaxy at boot', () => {
    const leftMidGalaxy = setRankRun(defaultSave(), { ...startRank('2026-10-26'), inGalaxy: true });

    it('is forfeited when no tab answers the probe, and Resume waits for the answer', async () => {
      const { run, refresh } = setup({}, () => FIELD, leftMidGalaxy);
      expect(run.rankLock).toBe('checking');
      // The app builds its view after the controller, so the first lock is read, not pushed.
      expect(refresh).not.toHaveBeenCalled();
      run.command({ kind: 'resumeRank' });
      expect(run.flow.screen).toBe('title');
      await vi.waitFor(() => {
        expect(run.rankLock).toBe('free');
      });
      expect(run.save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
      expect(refresh).toHaveBeenCalled();
    });

    it('says why the run lost a life, once, when it forfeits it', async () => {
      const { run, notify } = setup({}, () => FIELD, leftMidGalaxy);
      await vi.waitFor(() => {
        expect(run.rankLock).toBe('free');
      });
      expect(notify.mock.calls).toEqual([[LEFT_RUN_NOTICE]]);
    });

    it('says nothing when the owner answers, or when nothing was left mid-galaxy', async () => {
      const owned = setup({}, () => FIELD, leftMidGalaxy, fakePresence(true));
      await vi.waitFor(() => {
        expect(owned.run.rankLock).toBe('elsewhere');
      });
      expect(owned.notify).not.toHaveBeenCalled();
      expect(setup().notify).not.toHaveBeenCalled();
    });

    it('is forfeited when there is no channel to ask on', async () => {
      const { run } = setup({}, () => FIELD, leftMidGalaxy, createTabPresence(null));
      await vi.waitFor(() => {
        expect(run.save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
      });
    });

    it('is left alone when its owner answers: locked here, with no forfeit and no Resume', async () => {
      const { run } = setup({}, () => FIELD, leftMidGalaxy, fakePresence(true));
      await vi.waitFor(() => {
        expect(run.rankLock).toBe('elsewhere');
      });
      expect(run.save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
      run.command({ kind: 'resumeRank' });
      expect(run.flow.screen).toBe('title');
    });

    it('stays locked on mode select too: its Resume cannot play a run another tab owns', async () => {
      const { run } = setup({}, () => FIELD, leftMidGalaxy, fakePresence(true));
      await vi.waitFor(() => {
        expect(run.rankLock).toBe('elsewhere');
      });
      run.command({ kind: 'start' });
      expect(run.flow.screen).toBe('modeSelect');
      run.command({ kind: 'resumeRank' });
      expect(run.flow.screen).toBe('modeSelect');
      expect(run.world).toBeNull();
      expect(run.save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
    });
  });

  describe('the Rank lock over time', () => {
    const leftMidGalaxy = setRankRun(defaultSave(), { ...startRank('2026-10-26'), inGalaxy: true });

    /** A presence whose probes wait until the test answers them, oldest first. */
    function heldPresence() {
      const pending: ((owned: boolean) => void)[] = [];
      const presence: TabPresence = {
        probe: () => new Promise<boolean>((resolve) => pending.push(resolve)),
        own: () => () => undefined,
        dispose: () => undefined,
      };
      const answer = async (owned: boolean): Promise<void> => {
        pending.shift()?.(owned);
        await Promise.resolve();
        await Promise.resolve();
      };
      return { presence, answer, waiting: () => pending.length };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks again every 5 s while another tab plays the run, and forfeits it once that tab stops answering', async () => {
      vi.useFakeTimers();
      const held = heldPresence();
      const { run } = setup({}, () => FIELD, leftMidGalaxy, held.presence);
      await held.answer(true);
      expect(run.rankLock).toBe('elsewhere');
      expect(held.waiting()).toBe(0);
      vi.advanceTimersByTime(RECHECK_MS);
      expect(held.waiting()).toBe(1);
      await held.answer(true);
      expect(run.rankLock).toBe('elsewhere');
      expect(run.save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
      // The owner closed or crashed: the next probe goes unanswered.
      vi.advanceTimersByTime(RECHECK_MS);
      await held.answer(false);
      expect(run.rankLock).toBe('free');
      expect(run.save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
      vi.advanceTimersByTime(RECHECK_MS * 2);
      expect(held.waiting()).toBe(0);
    });

    it('a new Rank run started while the boot probe waits frees the lock, and the late answer forfeits nothing', async () => {
      const held = heldPresence();
      const { run } = setup({}, () => FIELD, leftMidGalaxy, held.presence);
      expect(run.rankLock).toBe('checking');
      run.command({ kind: 'start' });
      run.command({ kind: 'chooseMode', mode: 'rank' });
      run.command({ kind: 'chooseMode', mode: 'rank' });
      expect(run.flow.screen).toBe('playing');
      expect(run.rankLock).toBe('free');
      await held.answer(false);
      expect(run.save.rankRun).toMatchObject({ next: '1-1', lives: 3, inGalaxy: true });
      expect(run.rankLock).toBe('free');
    });

    it('nothing is forfeited after dispose, even when the pending probe then goes unanswered', async () => {
      const held = heldPresence();
      const { run } = setup({}, () => FIELD, leftMidGalaxy, held.presence);
      run.dispose();
      await held.answer(false);
      expect(run.save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
      expect(() => {
        run.dispose();
      }).not.toThrow();
    });
  });

  it('owns the Rank galaxy it plays, answering probes until the galaxy ends', () => {
    const owned: number[] = [];
    const released: number[] = [];
    const presence: TabPresence = {
      probe: () => Promise.resolve(false),
      own: (seq) => {
        owned.push(seq);
        return () => released.push(seq);
      },
      dispose: () => undefined,
    };
    const { run } = setup({}, () => FIELD, undefined, presence);
    run.command({ kind: 'start' });
    run.command({ kind: 'chooseMode', mode: 'rank' });
    expect(owned).toEqual([run.save.rankSeq]);
    run.pause();
    expect(released).toEqual([]);
    run.quit();
    expect(released).toEqual(owned);
  });

  it('refuses to start without a field, saying what to do', () => {
    const { run } = setup({ galaxy: '1-1' }, () => null);
    expect(() => {
      run.command({ kind: 'start' });
    }).toThrow(/give #app a visible size/);
  });
});
