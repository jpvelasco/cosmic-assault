import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Screen } from '../../src/app/flow';
import { localDate } from '../../src/app/date';
import { TWISTS_BY_ID } from '../../src/content/daily';
import { galaxyById } from '../../src/content/galaxies';
import { dailyGalaxy } from '../../src/meta/dailyGalaxy';
import { DAILY_LABEL, twistToast } from '../../src/ui/dailyCopy';
import { createRunController, LEFT_RUN_NOTICE, RECHECK_MS, type RunController, type RunControllerDeps } from '../../src/app/runController';
import type { PickupId } from '../../src/content/types';
import type { RunOverrides } from '../../src/app/seed';
import type { StorageEvents } from '../../src/app/saveStore';
import { setRankRun } from '../../src/meta/progress';
import { startRank } from '../../src/meta/rankRun';
import { defaultSave, SAVE_KEY, type SaveData } from '../../src/meta/save';
import { STEP_SECONDS } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { World } from '../../src/sim/world';
import { RingLog } from '../../src/platform/log';
import { createTabPresence, type TabPresence } from '../../src/platform/tabPresence';
import { NO_EVENTS } from '../helpers/flowRig';
import { memoryStorage } from '../helpers/memoryStorage';
import { seedFor } from '../../e2e/seeds';
import { CALLOUT_MS, TOAST_MS } from '../../src/ui/toast';

const FIELD = { width: 1280, height: 720 };
const NONE: RunOverrides = { seed: undefined, startLives: undefined, quality: undefined, galaxy: undefined, storm: undefined, today: undefined };

/** A presence where no other tab ever answers, unless `owner` is set: then one owns every run. */
function fakePresence(owner = false): TabPresence {
  return { probe: () => Promise.resolve(owner), own: () => () => undefined, dispose: () => undefined };
}

function setup(
  overrides: Partial<RunOverrides> = {},
  field: RunControllerDeps['field'] = () => FIELD,
  save?: SaveData,
  presence = fakePresence(),
  events: StorageEvents = NO_EVENTS,
  create = createRunController,
) {
  const storage = memoryStorage(save);
  const refresh = vi.fn();
  const screens: Screen[] = [];
  const onRunStarted = vi.fn();
  const notify = vi.fn<(text: string, ms?: number) => void>();
  const run = create({
    storage,
    overrides: { ...NONE, ...overrides },
    log: new RingLog(),
    events,
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

/** Lays a pickup of `kind` on the ship of the run in play, as a drop would, and steps once, which collects it. */
function collectOnShip(run: RunController, kind: PickupId): void {
  const world = run.world;
  if (world === null) throw new Error('the run must have started');
  const { x, y } = world.ship;
  world['run']?.['pickupField'].list.push({ id: 90, kind, x, y, px: x, py: y, vx: 0, vy: 0, expiresIn: 8 });
  run.step(STEP_SECONDS, NO_CONTROLS);
}

/** The save as `storage` holds it. */
const storedIn = (storage: ReturnType<typeof memoryStorage>): SaveData => JSON.parse(storage.items.get(SAVE_KEY) ?? '{}') as SaveData;

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
    expect(onRunStarted).toHaveBeenCalledWith(galaxyById('2-3'), null, null);
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
    const { run } = setup({ seed: seedFor('clears-1-1') }, () => FIELD, setRankRun(defaultSave(), saved));
    run.command({ kind: 'resumeRank' });
    const world = run.world;
    if (world === null) throw new Error('Resume must start a run');
    expect(run.runTotal).toBe(4000);
    // The 'clears-1-1' seed keeps the idle ship alive to the warp, so the clear bonus is the galaxy's only score.
    while (run.flow.screen === 'playing') run.step(STEP_SECONDS, NO_CONTROLS);
    expect(run.flow.screen).toBe('results');
    expect(run.runTotal).toBe(run.flow.result?.total);
    expect(run.runTotal).toBe(4000 + world.score);
  });

  it('is the galaxy score in Free play', () => {
    const { run } = setup({ galaxy: '1-1', seed: seedFor('clears-1-1') });
    run.command({ kind: 'start' });
    expect(run.runTotal).toBe(run.world?.score);
  });

  describe('the Daily', () => {
    const DATE = '2026-10-26';
    const daily = dailyGalaxy(DATE);
    /** Whether `world` plays as a fresh World of the Daily on `seed` does: the same rocks after its first idle seconds. */
    const playsOnSeed = (world: World | null, seed: number): boolean => {
      const twin = new World({ seed, field: FIELD, rules: { kind: 'galaxy', galaxy: daily.def, mode: 'daily' } });
      const rocks = (w: World) => JSON.stringify(w.asteroids.map(({ x, y }) => [x, y]));
      for (let i = 0; i < 6 / STEP_SECONDS; i++) {
        world?.step(STEP_SECONDS, NO_CONTROLS);
        twin.step(STEP_SECONDS, NO_CONTROLS);
      }
      return world !== null && twin.asteroids.length > 0 && rocks(world) === rocks(twin);
    };
    const playDaily = (overrides: Partial<RunOverrides> = {}, save?: SaveData) => {
      const tab = setup({ today: DATE, ...overrides }, undefined, save);
      tab.run.command({ kind: 'start' });
      tab.run.command({ kind: 'chooseMode', mode: 'daily' });
      return tab;
    };

    it("plays the pinned date's Daily Galaxy on its own World seed, with its target, and names the twist", () => {
      const { run, onRunStarted, notify } = playDaily();
      expect(run.flow).toMatchObject({ screen: 'playing', mode: 'daily', daily: DATE });
      expect(run.world?.galaxy).toEqual({ ...daily.def, label: DAILY_LABEL });
      expect(playsOnSeed(run.world, daily.seed)).toBe(true);
      expect(run.daily).toEqual(daily);
      expect(onRunStarted).toHaveBeenCalledWith({ ...daily.def, label: DAILY_LABEL }, daily.target, daily.seed);
      expect(notify).toHaveBeenCalledWith(twistToast(TWISTS_BY_ID[daily.twist].name));
    });

    it('ignores ?seed= for the Daily, whose date fixes its World', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { run } = playDaily({ seed: 42 });
      expect(playsOnSeed(run.world, daily.seed)).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring ?seed=42'));
    });

    it('takes today from ?today=, and writes the save, as a device clock set to that date would', () => {
      const { run, storage } = playDaily();
      expect(run.today()).toBe(DATE);
      expect(storage.items.has(SAVE_KEY)).toBe(true);
      expect(setup().run.today()).toBe(localDate(new Date()));
    });

    describe('on a date whose Daily cannot be built', () => {
      afterEach(() => {
        vi.doUnmock('../../src/meta/dailyGalaxy');
        vi.resetModules();
      });

      it('stays on mode select when it is chosen, and refreshes the cards, so its card shows it as unavailable', async () => {
        vi.resetModules();
        vi.doMock('../../src/meta/dailyGalaxy', async (actual) => ({
          ...(await actual<typeof import('../../src/meta/dailyGalaxy')>()),
          tryDailyGalaxy: () => ({ daily: null, error: new Error('The Daily Galaxy cannot be built') }),
        }));
        const { createRunController: withoutDaily } = await import('../../src/app/runController');
        const tab = setup({ today: DATE }, undefined, undefined, undefined, undefined, withoutDaily);
        tab.run.command({ kind: 'start' });
        tab.refresh.mockClear();
        tab.run.command({ kind: 'chooseMode', mode: 'daily' });
        expect(tab.run.flow.screen).toBe('modeSelect');
        expect(tab.run.world).toBeNull();
        expect(tab.screens).toEqual(['modeSelect']);
        expect(tab.refresh).toHaveBeenCalledTimes(1);
        tab.run.command({ kind: 'chooseMode', mode: 'free' });
        expect(tab.run.flow.screen).toBe('map');
      });
    });

    it('marks a first pickup seen, the one write outside the Daily record a Daily makes', () => {
      const progress: SaveData = { ...setRankRun(defaultSave(), startRank(DATE)), frontier: '1-3', galaxies: { '1-1': { bestScore: 1800, stars: 3 } }, classicBest: 4321 };
      const { run, storage } = playDaily({}, progress);
      const before = storedIn(storage);
      collectOnShip(run, 'doubleShot');
      expect(storedIn(storage)).toEqual({ ...before, seenPickups: ['doubleShot'] });
      expect(before).toMatchObject({ frontier: '1-3', classicBest: 4321, rankRun: progress.rankRun });
    });

    it('has no Daily outside one', () => {
      const { run } = setup({ galaxy: '1-1' });
      run.command({ kind: 'start' });
      expect(run.daily).toBeNull();
    });
  });

  describe('weapon tiers and pickups', () => {
    const armed = (weaponTier: 0 | 1 | 2 | 3) => setRankRun(defaultSave(), { ...startRank('2026-10-26'), weaponTier });
    const SPIN_AND_FIRE = { ...NO_CONTROLS, turn: 1, fire: true } as const;

    it('starts a Rank galaxy on the tier the run carries, and a Free play galaxy on tier 0', () => {
      const rank = setup({}, () => FIELD, armed(2));
      rank.run.command({ kind: 'resumeRank' });
      expect(rank.run.world?.weaponTier).toBe(2);
      const free = setup({ galaxy: '1-1' });
      free.run.command({ kind: 'start' });
      expect(free.run.world?.weaponTier).toBe(0);
    });

    it('forfeits a Rank galaxy on Quit with a tier lost, from the tier the ship has', () => {
      const { run } = setup({}, () => FIELD, armed(2));
      run.command({ kind: 'resumeRank' });
      run.pause();
      run.quit();
      expect(run.save.rankRun).toMatchObject({ lives: 2, weaponTier: 1, inGalaxy: false });
    });

    it('announces a kind on its first drop, with the line for it', () => {
      // Seed 5 drops a Shield about 7 s into a spinning, firing 1-1 run.
      const { run, notify } = setup({ galaxy: '1-1', seed: 5, startLives: 5 });
      run.command({ kind: 'start' });
      for (let i = 0; i < 20 * 120 && !notify.mock.calls.some(([text]) => text.startsWith('New:')); i++) run.step(STEP_SECONDS, SPIN_AND_FIRE);
      // A callout stays up longer than a status toast, so there is time to read what the pickup does.
      expect(notify).toHaveBeenCalledWith('New: Shield — absorbs one hit', CALLOUT_MS);
      expect(CALLOUT_MS).toBeGreaterThan(TOAST_MS);
      expect(run.save.seenPickups).toEqual([]);
    });

    it('counts a kind as seen once collected, and keeps its callout quiet after that', () => {
      const { run, notify } = setup({ galaxy: '1-1', seed: 5, startLives: 5 });
      run.command({ kind: 'start' });
      collectOnShip(run, 'shield');
      expect(run.save.seenPickups).toEqual(['shield']);
      run.step(STEP_SECONDS, NO_CONTROLS);
      expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('Shield'));
      run.pause();
      run.quit();
      run.command({ kind: 'start' });
      for (let i = 0; i < 20 * 120; i++) run.step(STEP_SECONDS, SPIN_AND_FIRE);
      expect(notify).not.toHaveBeenCalledWith('New: Shield — absorbs one hit', CALLOUT_MS);
    });

    it('writes the kind to the saved game outside debug runs', () => {
      const { run, storage } = setup({}, () => FIELD, armed(0));
      run.command({ kind: 'resumeRank' });
      collectOnShip(run, 'doubleShot');
      expect(storedIn(storage)).toMatchObject({ seenPickups: ['doubleShot'] });
    });
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

    it('asks again, rather than offering Resume, when its forfeit finds the run moved on since the probe', async () => {
      const held = heldPresence();
      const { run, storage } = setup({}, () => FIELD, leftMidGalaxy, held.presence);
      // Another tab's hit: stored, but its storage event has not reached this tab.
      storage.items.set(SAVE_KEY, JSON.stringify({ ...leftMidGalaxy, rankSeq: leftMidGalaxy.rankSeq + 1 }));
      await held.answer(false);
      expect(run.save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
      expect(run.rankLock).toBe('checking');
      expect(held.waiting()).toBe(1);
    });

    describe('after another tab writes the save', () => {
      const notMidGalaxy = setRankRun(defaultSave(), { ...startRank('2026-10-26'), inGalaxy: false });
      /** The other tab's write: the run is mid-galaxy, one save on. */
      const otherTabWrote = JSON.stringify({ ...leftMidGalaxy, rankSeq: notMidGalaxy.rankSeq + 1 });

      /** Storage events the test fires by hand, to every listener the controller added. */
      function storageEvents() {
        const listeners: ((event: { key: string | null }) => void)[] = [];
        const events: StorageEvents = {
          addEventListener: (_type, listener) => {
            listeners.push(listener);
          },
          removeEventListener: () => undefined,
        };
        return {
          events,
          fire: () => {
            listeners.forEach((listener) => {
              listener({ key: SAVE_KEY });
            });
          },
        };
      }

      it('a silent owner is asked once more, RECHECK_MS later, before the run is forfeited', async () => {
        vi.useFakeTimers();
        const held = heldPresence();
        const tabs = storageEvents();
        const { run, storage, notify } = setup({}, () => FIELD, notMidGalaxy, held.presence, tabs.events);
        expect(run.rankLock).toBe('free');
        storage.items.set(SAVE_KEY, otherTabWrote);
        tabs.fire();
        expect(run.rankLock).toBe('checking');
        // Silence may just mean the owner is busy starting its galaxy: nothing is forfeited yet.
        await held.answer(false);
        expect(run.save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
        expect(run.rankLock).toBe('checking');
        expect(held.waiting()).toBe(0);
        vi.advanceTimersByTime(RECHECK_MS);
        expect(held.waiting()).toBe(1);
        // The owner answers late, to the second ask: it is locked here, as its owner.
        await held.answer(true);
        expect(run.rankLock).toBe('elsewhere');
        expect(run.save.rankRun).toMatchObject({ lives: 3, inGalaxy: true });
        expect(notify).not.toHaveBeenCalled();
      });

      it('forfeits the run when it is still silent at the second ask', async () => {
        vi.useFakeTimers();
        const held = heldPresence();
        const tabs = storageEvents();
        const { run, storage, notify } = setup({}, () => FIELD, notMidGalaxy, held.presence, tabs.events);
        storage.items.set(SAVE_KEY, otherTabWrote);
        tabs.fire();
        await held.answer(false);
        vi.advanceTimersByTime(RECHECK_MS);
        await held.answer(false);
        expect(run.rankLock).toBe('free');
        expect(run.save.rankRun).toMatchObject({ lives: 2, inGalaxy: false });
        expect(notify.mock.calls).toEqual([[LEFT_RUN_NOTICE]]);
      });
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
