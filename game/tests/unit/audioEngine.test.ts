import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, needsSoundGesture, type AudioEngine } from '../../src/audio/engine';
import { SFX_NAMES } from '../../src/audio/sfx';
import { DEFAULT_SETTINGS, type Settings } from '../../src/app/settings';
import type { GalaxyId } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';

class FakeParam {
  value = 0;
  readonly setValueAtTime = vi.fn();
  readonly linearRampToValueAtTime = vi.fn();
  readonly exponentialRampToValueAtTime = vi.fn();
  readonly setTargetAtTime = vi.fn();
  readonly cancelScheduledValues = vi.fn();
}

class FakeNode {
  readonly outputs = new Set<FakeNode>();
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  readonly Q = new FakeParam();
  readonly threshold = new FakeParam();
  readonly ratio = new FakeParam();
  type = '';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
  constructor(readonly kind: string) {}
  connect(to: FakeNode): FakeNode {
    this.outputs.add(to);
    return to;
  }
  disconnect(): void {
    this.outputs.clear();
  }
}

let contexts: FakeContext[] = [];

class FakeContext {
  /** What a new context starts as, and whether `resume()` gets it running (a browser may refuse without a user gesture). */
  static startState: 'running' | 'suspended' = 'running';
  static resumeSucceeds = true;
  /** When set, `resume()` rejects with it, as a browser does when it refuses to start audio. */
  static resumeError: Error | null = null;
  static failBuild = false;
  state: 'running' | 'suspended' | 'interrupted' | 'closed' = FakeContext.startState;
  onstatechange: (() => void) | null = null;
  currentTime = 0;
  sampleRate = 8000;
  readonly nodes: FakeNode[] = [];
  readonly destination = new FakeNode('destination');
  readonly resume = vi.fn(() => {
    if (FakeContext.resumeError !== null) return Promise.reject(FakeContext.resumeError);
    if (FakeContext.resumeSucceeds) this.state = 'running';
    return Promise.resolve();
  });
  readonly suspend = vi.fn(() => {
    this.state = 'suspended';
    return Promise.resolve();
  });
  readonly close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  readonly createBuffer = vi.fn((_channels: number, length: number) => ({
    duration: length / this.sampleRate,
    getChannelData: () => new Float32Array(length),
  }));
  constructor() {
    contexts.push(this);
  }
  private make(kind: string): FakeNode {
    const node = new FakeNode(kind);
    this.nodes.push(node);
    return node;
  }
  createGain = () => {
    if (FakeContext.failBuild) throw new Error('graph refused');
    return this.make('gain');
  };
  createBiquadFilter = () => this.make('biquad');
  createDynamicsCompressor = () => this.make('compressor');
  createOscillator = () => this.make('oscillator');
  createBufferSource = () => this.make('bufferSource');
}

const SHOT: SimEvent = { type: 'shot', x: 0, y: 0 };
let visibility: 'visible' | 'hidden';
let win: EventTarget;
let doc: EventTarget;

function press(type: 'keydown' | 'pointerdown' | 'pointerup' | 'touchend' = 'keydown'): void {
  win.dispatchEvent(new Event(type));
}

function setVisibility(next: 'visible' | 'hidden'): void {
  visibility = next;
  doc.dispatchEvent(new Event('visibilitychange'));
}

const engines: AudioEngine[] = [];
function engine(settings: Settings = DEFAULT_SETTINGS, onFailure: (message: string) => void = vi.fn()): AudioEngine {
  const created = createAudioEngine(settings, onFailure);
  engines.push(created);
  return created;
}

const ctx = (): FakeContext => {
  const [first] = contexts;
  if (first === undefined) throw new Error('no context was created');
  return first;
};
const nodesOf = (kind: string): FakeNode[] => ctx().nodes.filter((n) => n.kind === kind);

beforeEach(() => {
  contexts = [];
  FakeContext.startState = 'running';
  FakeContext.resumeSucceeds = true;
  FakeContext.resumeError = null;
  FakeContext.failBuild = false;
  visibility = 'visible';
  win = new EventTarget();
  doc = new EventTarget();
  Object.defineProperty(doc, 'visibilityState', { get: () => visibility });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.useFakeTimers();
});

afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('needsSoundGesture', () => {
  it('is true while wanted sound waits for a key press or tap to start the context', () => {
    expect(needsSoundGesture('none', false)).toBe(true);
    expect(needsSoundGesture('suspended', false)).toBe(true);
  });

  it('is false once sound runs, while muted, and after the audio failed for good', () => {
    expect(needsSoundGesture('running', false)).toBe(false);
    expect(needsSoundGesture('none', true)).toBe(false);
    expect(needsSoundGesture('closed', false)).toBe(false);
  });
});

describe('unlocking', () => {
  it('creates no AudioContext until the first gesture', () => {
    const e = engine();
    expect(contexts).toHaveLength(0);
    expect(e.state).toBe('none');
  });

  it.each(['keydown', 'pointerdown'] as const)('creates the context once, on the first %s', (type) => {
    const e = engine();
    press(type);
    press('keydown');
    press('pointerdown');
    expect(contexts).toHaveLength(1);
    expect(e.state).toBe('running');
  });

  it('keeps listening while the browser leaves the context suspended, and a later gesture resumes it', async () => {
    FakeContext.startState = 'suspended';
    FakeContext.resumeSucceeds = false;
    const e = engine();
    press('pointerdown');
    expect(e.state).toBe('suspended');
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    press('pointerup');
    expect(ctx().resume).toHaveBeenCalledTimes(2);
    expect(contexts).toHaveLength(1);

    FakeContext.resumeSucceeds = true;
    press('touchend');
    await vi.waitFor(() => {
      expect(e.state).toBe('running');
    });
    const resumes = ctx().resume.mock.calls.length;
    press('keydown');
    press('pointerdown');
    expect(ctx().resume).toHaveBeenCalledTimes(resumes);
  });

  it('listens for pointerdown, pointerup, touchend and keydown', () => {
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const) {
      contexts = [];
      const e = engine();
      press(type);
      expect(contexts).toHaveLength(1);
      e.dispose();
    }
  });

  it('removes its four gesture listeners once the context is running', () => {
    const remove = vi.spyOn(win, 'removeEventListener');
    engine();
    press();
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['keydown', 'pointerdown', 'pointerup', 'touchend']);
  });

  it('keeps the listeners while the context stays suspended, and removes them on dispose', async () => {
    FakeContext.startState = 'suspended';
    FakeContext.resumeSucceeds = false;
    const remove = vi.spyOn(win, 'removeEventListener');
    const e = engine();
    press();
    await Promise.resolve();
    expect(remove).not.toHaveBeenCalled();
    e.dispose();
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it('never lets a refused resume() reach the console as an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    FakeContext.startState = 'suspended';
    FakeContext.resumeError = new Error('NotAllowedError');
    const remove = vi.spyOn(win, 'removeEventListener');
    const e = engine();
    press('pointerdown');
    await Promise.resolve();
    press('keydown');
    await Promise.resolve();
    expect(ctx().resume).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
    e.setMuted(true);
    e.setMuted(false);
    setVisibility('hidden');
    ctx().suspend.mockRejectedValue(new Error('InvalidStateError'));
    setVisibility('hidden');
    vi.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('reports a context the browser left suspended as suspended', () => {
    const e = engine();
    press();
    ctx().state = 'suspended';
    expect(e.state).toBe('suspended');
  });

  it('removes its listeners on dispose, so a later gesture builds nothing', () => {
    const e = engine();
    e.dispose();
    press();
    expect(contexts).toHaveLength(0);
  });

  describe('after the context first runs', () => {
    /** A context that ran, so the gesture listeners went, and a spy on the ones added after. */
    async function ranOnce(): Promise<{ e: AudioEngine; added: () => string[] }> {
      const e = engine();
      press();
      await Promise.resolve();
      const add = vi.spyOn(win, 'addEventListener');
      return { e, added: () => add.mock.calls.map(([type]) => type).sort() };
    }

    it('listens for gestures again when a resume on return to the tab is refused', async () => {
      const { added } = await ranOnce();
      setVisibility('hidden');
      FakeContext.resumeSucceeds = false;
      setVisibility('visible');
      await vi.waitFor(() => {
        expect(added()).toEqual(['keydown', 'pointerdown', 'pointerup', 'touchend']);
      });
      FakeContext.resumeSucceeds = true;
      press('touchend');
      await vi.waitFor(() => {
        expect(ctx().state).toBe('running');
      });
    });

    it('listens for gestures again when a rejected resume on return leaves the context suspended', async () => {
      const { added } = await ranOnce();
      setVisibility('hidden');
      FakeContext.resumeError = new Error('NotAllowedError');
      setVisibility('visible');
      await vi.waitFor(() => {
        expect(added()).toHaveLength(4);
      });
    });

    it.each(['interrupted', 'suspended'] as const)('listens for gestures again when the context turns %s by itself', async (state) => {
      const { added } = await ranOnce();
      ctx().state = state;
      ctx().onstatechange?.();
      expect(added()).toEqual(['keydown', 'pointerdown', 'pointerup', 'touchend']);
      FakeContext.resumeSucceeds = true;
      const remove = vi.spyOn(win, 'removeEventListener');
      press();
      await vi.waitFor(() => {
        expect(remove).toHaveBeenCalledTimes(4);
      });
    });

    it('does not listen again while muted, or once the context runs again', async () => {
      const { e, added } = await ranOnce();
      e.setMuted(true);
      ctx().state = 'interrupted';
      ctx().onstatechange?.();
      ctx().state = 'running';
      ctx().onstatechange?.();
      setVisibility('hidden');
      setVisibility('visible');
      await Promise.resolve();
      expect(added()).toEqual([]);
    });
  });

  it('closes the context on dispose', () => {
    const e = engine();
    press();
    e.dispose();
    expect(ctx().close).toHaveBeenCalledTimes(1);
  });
});

describe('node graph', () => {
  it('wires sfx and music buses into master, then a −14 dB 4:1 compressor, then the output', () => {
    engine();
    press();
    const [master, sfx, music] = nodesOf('gain') as [FakeNode, FakeNode, FakeNode];
    const [lowpass] = nodesOf('biquad') as [FakeNode];
    const [compressor] = nodesOf('compressor') as [FakeNode];
    expect([...sfx.outputs]).toEqual([master]);
    expect([...music.outputs]).toEqual([lowpass]);
    expect(lowpass.type).toBe('lowpass');
    expect(lowpass.frequency.value).toBe(2600);
    expect([...lowpass.outputs]).toEqual([master]);
    expect([...master.outputs]).toEqual([compressor]);
    expect(compressor.threshold.value).toBe(-14);
    expect(compressor.ratio.value).toBe(4);
    expect([...compressor.outputs]).toEqual([ctx().destination]);
  });

  it('applies the volumes to the buses and creates one shared noise buffer', () => {
    engine({ ...DEFAULT_SETTINGS, musicVolume: 0.5, sfxVolume: 0.25 });
    press();
    const [master, sfx, music] = nodesOf('gain') as [FakeNode, FakeNode, FakeNode];
    expect(master.gain.value).toBe(1);
    expect(sfx.gain.value).toBe(0.25);
    expect(music.gain.value).toBeCloseTo(0.5 * 0.45, 10);
    expect(ctx().createBuffer).toHaveBeenCalledTimes(1);
  });

  it('starts silent when the saved setting is muted', () => {
    const e = engine({ ...DEFAULT_SETTINGS, muted: true });
    press();
    expect(e.muted).toBe(true);
    expect((nodesOf('gain')[0] as FakeNode).gain.value).toBe(0);
  });
});

describe('sound effects', () => {
  it('drops shots beyond three per frame and counts again after beginFrame', () => {
    const e = engine();
    press();
    const sources = (): number => nodesOf('oscillator').length;
    const before = sources();
    e.handle([SHOT, SHOT, SHOT, SHOT, SHOT]);
    expect(sources() - before).toBe(3);
    e.beginFrame();
    e.handle([SHOT]);
    expect(sources() - before).toBe(4);
  });

  it('starts a boss kill\'s warp 0.3 s after the boss goes down, and the results fanfare after both, on the audio clock', () => {
    const e = engine();
    press();
    const c = ctx();
    c.currentTime = 2;
    const startOf = (node: FakeNode): number => node.start.mock.calls[0]?.[0] as number;
    /** The voices `act` starts, in the order it starts them. */
    const started = (act: () => void): number[] => {
      const [oscillators, sources] = [nodesOf('oscillator').length, nodesOf('bufferSource').length];
      act();
      return [...nodesOf('oscillator').slice(oscillators), ...nodesOf('bufferSource').slice(sources)].map(startOf);
    };
    const down = started(() => {
      e.handle([{ type: 'bossDown', id: 'sentinel' }]);
    });
    const kill = started(() => {
      e.handle([{ type: 'bossDown', id: 'sentinel' }, { type: 'warpOut' }]);
    });
    expect(new Set(down)).toEqual(new Set([2]));
    // The same boss-down voices at once, and the warp's 0.3 s behind them.
    expect(kill.filter((t) => t === 2)).toHaveLength(down.length);
    expect(kill.filter((t) => t !== 2).every((t) => Math.abs(t - 2.3) < 1e-9)).toBe(true);
    expect(kill.length).toBeGreaterThan(down.length);
    const fanfare = started(() => {
      e.setScreen('results');
    });
    expect(fanfare.length).toBeGreaterThan(0);
    expect(Math.min(...fanfare)).toBeGreaterThan(2.3);
  });

  it('plays the results fanfare through its own bus, and fades that bus out when the card is left', () => {
    const e = engine();
    press();
    const before = nodesOf('gain').length;
    e.setScreen('results');
    const made = nodesOf('gain').slice(before);
    const sfxBus = nodesOf('gain')[1];
    const bus = made.find((node) => sfxBus !== undefined && node.outputs.has(sfxBus));
    if (bus === undefined) throw new Error('the fanfare should play through a bus of its own on the effects bus');
    // Every fanfare voice goes through that bus, none straight to the effects bus.
    expect(made.filter((node) => node !== bus && sfxBus !== undefined && node.outputs.has(sfxBus))).toEqual([]);
    const silenced = (): boolean => bus.gain.setTargetAtTime.mock.calls.some(([value]) => value === 0);
    expect(silenced()).toBe(false);
    e.setScreen('playing');
    expect(silenced()).toBe(true);
  });

  it('plays one swarm buzz for a whole drone group arriving in a frame', () => {
    const e = engine();
    press();
    const drone: SimEvent = { type: 'foeSpawned', id: 1, kind: 'drone', x: 0, y: 0 };
    const before = nodesOf('oscillator').length;
    e.handle([drone]);
    const one = nodesOf('oscillator').length - before;
    expect(one).toBeGreaterThan(0);
    e.handle([drone, drone, drone]);
    expect(nodesOf('oscillator').length - before).toBe(one);
    e.beginFrame();
    e.handle([drone, drone]);
    expect(nodesOf('oscillator').length - before).toBe(2 * one);
  });

  it('does not cap other sounds', () => {
    const e = engine();
    press();
    const before = nodesOf('oscillator').length;
    for (let i = 0; i < 5; i++) e.play('uiClick');
    expect(nodesOf('oscillator').length - before).toBe(5);
  });

  it('plays nothing before the context exists', () => {
    const e = engine();
    expect(() => {
      e.handle([SHOT]);
      e.play('gameOver');
    }).not.toThrow();
    expect(contexts).toHaveLength(0);
  });

  it('builds every sound from short-lived nodes that stop and disconnect themselves', () => {
    const e = engine();
    press();
    for (const name of SFX_NAMES) e.play(name);
    const voices = [...nodesOf('oscillator'), ...nodesOf('bufferSource')];
    expect(voices.length).toBeGreaterThan(SFX_NAMES.length);
    for (const voice of voices) {
      expect(voice.start).toHaveBeenCalledTimes(1);
      expect(voice.stop).toHaveBeenCalledTimes(1);
      expect(voice.onended).toBeTypeOf('function');
    }
  });

  it('keeps music voices from leaking: every voice is stopped and its node chain disconnected when it ends', () => {
    engine();
    press();
    const c = ctx();
    for (let i = 0; i < 160; i++) {
      c.currentTime += 0.025;
      vi.advanceTimersByTime(25);
    }
    const voices = [...nodesOf('oscillator'), ...nodesOf('bufferSource')];
    expect(voices.length).toBeGreaterThan(20);
    for (const voice of voices) {
      expect(voice.stop).toHaveBeenCalledTimes(1);
      voice.onended?.();
    }
    // The master, sfx and music gains, and the music bus's lane for its theme.
    const fixed = new Set([...nodesOf('gain').slice(0, 4), nodesOf('biquad')[0], nodesOf('compressor')[0]]);
    const connected = c.nodes.filter((n) => !fixed.has(n) && n.outputs.size > 0);
    expect(connected).toEqual([]);
  });
});

describe('the gravity well hum', () => {
  const START: SimEvent = { type: 'wellStart', id: 1, kind: 'gravityWell' };
  const END: SimEvent = { type: 'wellEnd', id: 1, kind: 'gravityWell' };
  /** The hum's oscillators: the only ones in these tests started with no stop scheduled. */
  const looping = (): FakeNode[] => nodesOf('oscillator').filter((n) => n.stop.mock.calls.length === 0);
  const playingEngine = (): AudioEngine => {
    const e = engine();
    press();
    e.setScreen('playing');
    return e;
  };

  it('loops a low voice from the moment a well pulls until it lets go, then stops and unhooks every node of it', () => {
    const e = playingEngine();
    e.handle([START]);
    const hum = looping();
    expect(hum.length).toBeGreaterThan(0);
    expect(Math.min(...hum.map((n) => n.frequency.value))).toBeLessThan(80);
    e.handle([{ type: 'shot', x: 0, y: 0 }]);
    expect(looping()).toEqual(hum);
    e.handle([END]);
    expect(looping()).toEqual([]);
    for (const osc of hum) expect(osc.stop).toHaveBeenCalledTimes(1);
    for (const voice of [...nodesOf('oscillator'), ...nodesOf('bufferSource')]) voice.onended?.();
    // The master, sfx and music gains, and the music bus's lane for its theme.
    const fixed = new Set([...nodesOf('gain').slice(0, 4), nodesOf('biquad')[0], nodesOf('compressor')[0]]);
    expect(ctx().nodes.filter((n) => !fixed.has(n) && n.outputs.size > 0)).toEqual([]);
  });

  it('fades it out on the audio clock, level and swell both ramped to silence, before its voices stop', () => {
    const e = playingEngine();
    const c = ctx();
    c.currentTime = 3;
    const before = nodesOf('gain').length;
    e.handle([START]);
    const hum = looping();
    const made = nodesOf('gain').slice(before);
    c.currentTime = 9;
    e.handle([END]);
    const ramps = made.filter((g) => g.gain.linearRampToValueAtTime.mock.calls.some(([value, at]) => value === 0 && (at as number) > 9));
    // The hum's level and the depth of its swell: nothing is left modulating the gain once they reach 0.
    expect(ramps).toHaveLength(2);
    const silentAt = Math.max(...ramps.flatMap((g) => g.gain.linearRampToValueAtTime.mock.calls.filter(([value]) => value === 0).map(([, at]) => at as number)));
    for (const g of ramps) expect(g.gain.setValueAtTime).toHaveBeenCalledWith(g.gain.value, 9);
    for (const osc of hum) expect(osc.stop.mock.calls[0]?.[0] as number).toBeGreaterThan(silentAt);
  });

  it('starts it once, however many starts a frame brings', () => {
    const e = playingEngine();
    e.handle([START]);
    const hum = looping();
    e.handle([START]);
    expect(looping()).toEqual(hum);
  });

  it('stops it on pause and brings it back on resume, while the well still pulls', () => {
    const e = playingEngine();
    e.handle([START]);
    e.setScreen('paused');
    expect(looping()).toEqual([]);
    e.setScreen('playing');
    expect(looping().length).toBeGreaterThan(0);
  });

  it('stops it for good when the run is left for a menu or ends, so the next run starts quiet', () => {
    for (const screen of ['title', 'gameOver', 'results'] as const) {
      const e = playingEngine();
      e.handle([START]);
      e.setScreen('paused');
      e.setScreen(screen);
      e.setScreen('playing');
      expect(looping(), screen).toEqual([]);
      contexts = [];
    }
  });

  it.each([
    ['the warp', { type: 'warpOut' }],
    ['game over', { type: 'gameOver', score: 0 }],
  ] as const)('stops it when %s ends the galaxy with the well still pulling', (_name, event) => {
    const e = playingEngine();
    e.handle([START]);
    e.handle([event]);
    expect(looping()).toEqual([]);
  });

  it('stops it on mute, as after a crash, and brings it back on unmute', () => {
    const e = playingEngine();
    e.handle([START]);
    e.setMuted(true);
    expect(looping()).toEqual([]);
    e.setMuted(false);
    expect(looping().length).toBeGreaterThan(0);
  });

  it('stops it on dispose', () => {
    const e = playingEngine();
    e.handle([START]);
    const hum = looping();
    e.dispose();
    for (const osc of hum) expect(osc.stop).toHaveBeenCalledTimes(1);
  });

  it("runs a danger zone's hum beside a well's: each starts and stops on its own events", () => {
    const e = playingEngine();
    e.handle([START]);
    const well = looping();
    e.handle([{ type: 'zoneStart', id: 2 }]);
    const both = looping();
    expect(both.length).toBeGreaterThan(well.length);
    const zone = both.filter((n) => !well.includes(n));
    e.handle([{ type: 'zoneEnd', id: 2 }]);
    expect(looping()).toEqual(well);
    for (const osc of zone) expect(osc.stop).toHaveBeenCalledTimes(1);
    e.handle([{ type: 'zoneStart', id: 3 }, { type: 'warpOut' }]);
    expect(looping()).toEqual([]);
  });

  it('builds no hum before the context runs, and starts it once it does', () => {
    FakeContext.startState = 'suspended';
    FakeContext.resumeSucceeds = false;
    const e = engine();
    press();
    e.setScreen('playing');
    e.handle([START]);
    expect(nodesOf('oscillator')).toEqual([]);
    ctx().state = 'running';
    ctx().onstatechange?.();
    expect(looping().length).toBeGreaterThan(0);
  });
});

describe('music', () => {
  it('schedules notes ahead of the audio clock while the timer runs, and stops on dispose', () => {
    const e = engine();
    press();
    const c = ctx();
    c.currentTime = 0.025;
    vi.advanceTimersByTime(25);
    const first = nodesOf('oscillator').length;
    expect(first).toBeGreaterThan(0);
    for (const o of nodesOf('oscillator')) {
      expect(o.start.mock.calls[0]?.[0]).toBeLessThan(c.currentTime + 0.3);
    }
    e.dispose();
    const count = c.nodes.length;
    c.currentTime += 5;
    vi.advanceTimersByTime(1000);
    expect(c.nodes).toHaveLength(count);
  });

  it('adds nothing while the context clock is frozen (suspended)', () => {
    engine();
    press();
    vi.advanceTimersByTime(25);
    const count = ctx().nodes.length;
    vi.advanceTimersByTime(500);
    expect(ctx().nodes).toHaveLength(count);
  });

  it('ducks and restores the music bus with setTargetAtTime', () => {
    const e = engine({ ...DEFAULT_SETTINGS, musicVolume: 0.5 });
    press();
    const music = nodesOf('gain')[2] as FakeNode;
    e.setMusicLevel('paused');
    expect(music.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5 * 0.3, 0, expect.any(Number));
    e.setMusicLevel('play');
    expect(music.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 0, expect.any(Number));
    e.setMusicLevel('menu');
    expect(music.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5 * 0.45, 0, expect.any(Number));
  });

  it('ramps both buses to new volumes, the music one scaled by the current level', () => {
    const e = engine();
    press();
    const [, sfx, music] = nodesOf('gain') as [FakeNode, FakeNode, FakeNode];
    e.setMusicLevel('play');
    e.setVolumes(0.2, 0.9);
    expect(music.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.2, 0, expect.any(Number));
    expect(sfx.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.9, 0, expect.any(Number));
    e.setMusicLevel('paused');
    expect(music.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.2 * 0.3, 0, expect.any(Number));
    expect(sfx.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.9, 0, expect.any(Number));
  });

  it('builds the buses with volumes set before the context exists', () => {
    const e = engine();
    e.setVolumes(0.2, 0.9);
    press();
    const [, sfx, music] = nodesOf('gain') as [FakeNode, FakeNode, FakeNode];
    expect(sfx.gain.value).toBe(0.9);
    expect(music.gain.value).toBeCloseTo(0.2 * 0.45, 10);
  });

  it('remembers a level set before the context exists', () => {
    const e = engine({ ...DEFAULT_SETTINGS, musicVolume: 0.5 });
    e.setMusicLevel('play');
    press();
    expect((nodesOf('gain')[2] as FakeNode).gain.value).toBe(0.5);
  });
});

describe('mute and visibility', () => {
  it('mutes by ramping the master gain to 0 and back to 1', () => {
    const e = engine();
    press();
    const master = nodesOf('gain')[0] as FakeNode;
    e.setMuted(true);
    expect(e.muted).toBe(true);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
    e.setMuted(false);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, expect.any(Number));
  });

  it('holds the mute before the context exists', () => {
    const e = engine();
    e.setMuted(true);
    press();
    expect((nodesOf('gain')[0] as FakeNode).gain.value).toBe(0);
  });

  it('suspends when hidden and resumes when visible again', () => {
    engine();
    press();
    setVisibility('hidden');
    expect(ctx().suspend).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    expect(ctx().state).toBe('running');
  });

  it('stays suspended on return while muted, and wakes on unmute', () => {
    const e = engine();
    press();
    e.setMuted(true);
    setVisibility('hidden');
    setVisibility('visible');
    expect(ctx().resume).not.toHaveBeenCalled();
    e.setMuted(false);
    expect(ctx().resume).toHaveBeenCalledTimes(1);
  });

  it('ignores visibility changes before any gesture', () => {
    engine();
    setVisibility('hidden');
    setVisibility('visible');
    expect(contexts).toHaveLength(0);
  });
});

const voiceNodes = (): FakeNode[] => [...nodesOf('oscillator'), ...nodesOf('bufferSource')];
const voiceCount = (): number => voiceNodes().length;
/** Start times of the voices built since `known` was taken. */
const startsSince = (known: ReadonlySet<FakeNode>): number[] =>
  voiceNodes()
    .filter((n) => !known.has(n))
    .map((n) => n.start.mock.calls[0]?.[0] as number);

/** Runs `seconds` of the 25 ms music timer, advancing the fake audio clock only while the context runs. */
function runClock(seconds: number): void {
  for (let i = 0; i < seconds * 40; i++) {
    if (ctx().state === 'running') ctx().currentTime += 0.025;
    vi.advanceTimersByTime(25);
  }
}

describe('no nodes while suspended or muted', () => {
  it('builds no voices while the browser holds the context suspended', () => {
    FakeContext.startState = 'suspended';
    FakeContext.resumeSucceeds = false;
    const e = engine();
    press();
    e.handle([SHOT, { type: 'shipHit', x: 0, y: 0, livesLeft: 1 }]);
    e.play('uiClick');
    runClock(2);
    expect(voiceCount()).toBe(0);
  });

  it('starts playing once a later gesture gets the context running', () => {
    FakeContext.startState = 'suspended';
    FakeContext.resumeSucceeds = false;
    const e = engine();
    press();
    runClock(1);
    FakeContext.resumeSucceeds = true;
    press('pointerup');
    e.play('uiClick');
    runClock(1);
    expect(voiceCount()).toBeGreaterThan(5);
  });

  it('builds no sound or music while muted, even with the context running', () => {
    const e = engine({ ...DEFAULT_SETTINGS, muted: true });
    press();
    e.handle([SHOT]);
    e.play('gameOver');
    runClock(2);
    expect(ctx().state).toBe('running');
    expect(voiceCount()).toBe(0);
  });

  it('builds nothing after a mute, a tab switch and a return, and wakes cleanly on unmute', () => {
    const e = engine();
    press();
    runClock(1);
    e.setMuted(true);
    setVisibility('hidden');
    setVisibility('visible');
    expect(ctx().state).toBe('suspended');
    const before = voiceCount();
    const known = new Set(voiceNodes());
    for (let i = 0; i < 50; i++) e.play('boomLarge');
    runClock(3);
    expect(voiceCount()).toBe(before);

    e.setMuted(false);
    expect(ctx().state).toBe('running');
    const resumedAt = ctx().currentTime;
    e.play('uiClick');
    runClock(1);
    // One second of music plus one click: tens of voices at most, not a backlog of the muted minutes.
    expect(voiceCount() - before).toBeLessThan(45);
    for (const t of startsSince(known)) expect(t).toBeGreaterThanOrEqual(resumedAt - 0.001);
  });

  it('skips the muted stretch of music on unmute instead of replaying it', () => {
    const e = engine();
    press();
    runClock(1);
    e.setMuted(true);
    const before = voiceCount();
    const known = new Set(voiceNodes());
    runClock(60);
    expect(voiceCount()).toBe(before);
    const unmutedAt = ctx().currentTime;
    e.setMuted(false);
    runClock(1);
    const starts = startsSince(known);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.length).toBeLessThan(40);
    for (const t of starts) expect(t).toBeGreaterThanOrEqual(unmutedAt - 0.001);
  });
});

describe('failure cleanup', () => {
  it('closes the context once when a call throws, and dispose does not close it again', () => {
    const e = engine();
    press();
    ctx().createOscillator = () => {
      throw new Error('out of voices');
    };
    e.play('uiClick');
    expect(ctx().close).toHaveBeenCalledTimes(1);
    e.dispose();
    expect(ctx().close).toHaveBeenCalledTimes(1);
  });

  it('closes a context whose graph could not be built', () => {
    FakeContext.failBuild = true;
    const onFailure = vi.fn();
    const e = engine(DEFAULT_SETTINGS, onFailure);
    press();
    expect(contexts).toHaveLength(1);
    expect(ctx().close).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(e.state).toBe('none');
    press();
    expect(contexts).toHaveLength(1);
  });

  it('survives a close() that throws', () => {
    const e = engine();
    press();
    ctx().close.mockImplementation(() => {
      throw new Error('already closed');
    });
    expect(() => {
      e.dispose();
    }).not.toThrow();
  });
});

describe('unavailable audio', () => {
  it('stays silent and warns once when AudioContext does not exist', () => {
    vi.stubGlobal('AudioContext', undefined);
    const onFailure = vi.fn();
    const e = engine(DEFAULT_SETTINGS, onFailure);
    press();
    press();
    expect(() => {
      e.handle([SHOT]);
      e.setMuted(true);
      e.setMusicLevel('play');
    }).not.toThrow();
    expect(e.state).toBe('none');
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toMatch(/no AudioContext.*try another browser/s);
  });

  it('switches sound off once a WebAudio call throws, without throwing into the game', () => {
    const onFailure = vi.fn();
    const e = engine(DEFAULT_SETTINGS, onFailure);
    press();
    ctx().createOscillator = () => {
      throw new Error('out of voices');
    };
    expect(() => {
      e.play('uiClick');
      e.play('pause');
    }).not.toThrow();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toContain('out of voices');
  });

  it('survives a context that refuses to resume', () => {
    const e = engine();
    press();
    ctx().resume.mockRejectedValue(new Error('blocked'));
    expect(() => {
      e.setMuted(true);
      e.setMuted(false);
    }).not.toThrow();
  });
});

describe('music themes', () => {
  const start = (id: GalaxyId): SimEvent => ({ type: 'galaxyStart', id });
  const INTRO: SimEvent = { type: 'bossIntro', id: 'sentinel' };
  /** A Drift bar at 96 bpm lasts 2.5 s, and the music starts 0.1 s after the first gesture. */
  const BAR = 2.5;
  const FIRST_BEAT = 0.1;

  /** The buses of the themes now sounding: the gain nodes feeding the music bus. */
  const lanes = (): FakeNode[] => {
    const music = nodesOf('gain')[2] as FakeNode;
    return nodesOf('gain').filter((n) => n.outputs.has(music));
  };
  const reaches = (from: FakeNode, to: FakeNode): boolean => from === to || [...from.outputs].some((n) => reaches(n, to));
  /** Start times of the music voices that sound on `lane`. */
  const startsOn = (lane: FakeNode): number[] => voiceNodes().filter((v) => reaches(v, lane)).map((v) => v.start.mock.calls[0]?.[0] as number);
  /** The pitch classes (0-11) of the oscillators sounding on `lane`; noise has none. */
  const pitchClassesOn = (lane: FakeNode): Set<number> =>
    new Set(
      nodesOf('oscillator')
        .filter((v) => reaches(v, lane))
        .map((v) => (((Math.round(69 + 12 * Math.log2((v.frequency.setValueAtTime.mock.calls[0]?.[0] as number) / 440)) % 12) + 12) % 12)),
    );
  const D_MAJOR = [2, 4, 6, 7, 9, 11, 1];
  const A_MINOR = [9, 11, 0, 2, 4, 5, 7];
  const setAt = (lane: FakeNode, value: number): number | undefined =>
    (lane.gain.setValueAtTime.mock.calls as [number, number][]).find(([v]) => v === value)?.[1];

  describe('which theme is chosen', () => {
    it('starts on the Drift, before the audio context exists too', () => {
      const e = engine();
      expect(e.theme).toBe('drift');
      e.handle([SHOT]);
      expect(e.theme).toBe('drift');
      expect(contexts).toHaveLength(0);
    });

    it.each([
      ['1-1', 'drift'],
      ['2-1', 'ionReach'],
      ['2-5', 'ionReach'],
      ['3-2', 'crimsonNebula'],
      ['4-1', 'voidRift'],
      ['5-3', 'singularity'],
    ] as const)('takes galaxy %s\'s theme, %s, as it starts', (id, theme) => {
      const e = engine();
      e.handle([start(id)]);
      expect(e.theme).toBe(theme);
    });

    it('turns to the Dimension\'s boss variant at the boss intro, and back to its theme at the next galaxy', () => {
      const e = engine();
      e.handle([start('2-6')]);
      expect(e.theme).toBe('ionReach');
      e.handle([INTRO]);
      expect(e.theme).toBe('ionReachBoss');
      e.handle([start('2-6')]);
      expect(e.theme).toBe('ionReach');
      e.handle([start('1-6'), INTRO]);
      expect(e.theme).toBe('driftBoss');
    });

    it.each([
      ['3-6', 'crimsonNebula'],
      ['4-6', 'voidRift'],
      ['5-6', 'singularity'],
    ] as const)('plays %s\'s boss variant of %s from its intro', (id, theme) => {
      const e = engine();
      e.handle([start(id)]);
      expect(e.theme).toBe(theme);
      e.handle([INTRO]);
      expect(e.theme).toBe(`${theme}Boss`);
    });

    it('keeps the boss variant through a pause, and plays the last-played Dimension\'s plain theme on every menu', () => {
      const e = engine();
      e.handle([start('2-6'), INTRO]);
      e.setScreen('playing');
      e.setScreen('paused');
      expect(e.theme).toBe('ionReachBoss');
      e.setScreen('playing');
      expect(e.theme).toBe('ionReachBoss');
      e.setScreen('results');
      expect(e.theme).toBe('ionReach');
      e.setScreen('title');
      expect(e.theme).toBe('ionReach');
    });
  });

  describe('changing theme while it plays', () => {
    function playing(): AudioEngine {
      const e = engine();
      press();
      runClock(1);
      return e;
    }

    /** Runs the clock until the change happens, up to 10 s; returns the old bus and the new one while both are connected. */
    function untilChange(): [FakeNode, FakeNode] {
      for (let i = 0; i < 400 && lanes().length < 2; i++) runClock(0.025);
      const both = lanes();
      expect(both).toHaveLength(2);
      return both as [FakeNode, FakeNode];
    }

    it('waits for the next bar line, then fades the old theme out and the new one in', () => {
      const e = playing();
      const [old] = lanes() as [FakeNode];
      expect(lanes()).toHaveLength(1);
      e.handle([start('2-1')]);
      expect(lanes()).toHaveLength(1);
      const [, fresh] = untilChange();
      const at = setAt(fresh, 0) as number;
      expect((at - FIRST_BEAT) / BAR).toBeCloseTo(Math.round((at - FIRST_BEAT) / BAR), 9);
      expect(at).toBeGreaterThan(1);
      expect(setAt(old, 1)).toBe(at);
      expect(old.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.any(Number));
      expect(fresh.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.any(Number));
      expect(startsOn(old).every((t) => t < at)).toBe(true);
      expect(startsOn(fresh).length).toBeGreaterThan(0);
      expect(startsOn(fresh).every((t) => t >= at)).toBe(true);
      // Nothing of the Drift (Am F C G) is on the new lane, even a note on the bar line itself, nor of Ion Reach on the old.
      expect([...pitchClassesOn(fresh)].every((pc) => D_MAJOR.includes(pc))).toBe(true);
      expect([...pitchClassesOn(old)].every((pc) => A_MINOR.includes(pc))).toBe(true);
      expect(pitchClassesOn(fresh).size).toBeGreaterThanOrEqual(3);
    });

    it.each([
      ['the Drift', '1-6', 0.625],
      ['Ion Reach', '2-6', 60 / 110],
    ] as const)('switches %s to its boss variant on the next beat, inside the 2 s boss intro', (_name, galaxy, beat) => {
      const e = playing();
      e.handle([start(galaxy)]);
      for (let i = 0; i < 400 && lanes().length < 2; i++) runClock(0.025);
      runClock(1);
      expect(lanes()).toHaveLength(1);
      const asked = ctx().currentTime;
      e.handle([INTRO]);
      const [, fresh] = untilChange();
      const at = setAt(fresh, 0) as number;
      expect(at).toBeGreaterThanOrEqual(asked);
      expect(at - asked).toBeLessThanOrEqual(beat + 0.2);
      expect(at - asked).toBeLessThan(2);
      expect(e.theme).toBe(galaxy === '1-6' ? 'driftBoss' : 'ionReachBoss');
    });

    it('drops the faded-out bus once it is silent, and not before', () => {
      const e = playing();
      const [old] = lanes() as [FakeNode];
      e.handle([start('2-1')]);
      for (let i = 0; i < 400 && lanes().length < 2; i++) runClock(0.025);
      expect(lanes()).toHaveLength(2);
      expect(old.outputs.size).toBe(1);
      runClock(0.3);
      expect(old.outputs.size).toBe(1);
      runClock(0.5);
      expect(old.outputs.size).toBe(0);
      expect(lanes()).toHaveLength(1);
    });

    it('makes one change for requests made before the bar line, to the last one asked', () => {
      const e = playing();
      e.handle([start('2-6')]);
      e.handle([INTRO]);
      untilChange();
      expect(e.theme).toBe('ionReachBoss');
      runClock(0.3);
      expect(lanes()).toHaveLength(2);
    });

    it('makes none if the theme asked for is back to the one playing before the bar line', () => {
      const e = playing();
      e.handle([start('2-1')]);
      e.handle([start('1-1')]);
      let most = 0;
      for (let i = 0; i < 240; i++) {
        runClock(0.025);
        most = Math.max(most, lanes().length);
      }
      expect(most).toBe(1);
      expect(e.theme).toBe('drift');
    });

    it('waits through a mute and changes at the first bar line after the unmute, never replaying the muted stretch', () => {
      const e = playing();
      e.setMuted(true);
      e.handle([start('2-1')]);
      runClock(10);
      expect(lanes()).toHaveLength(1);
      const unmutedAt = ctx().currentTime;
      e.setMuted(false);
      const [, fresh] = untilChange();
      expect(setAt(fresh, 0)).toBeGreaterThanOrEqual(unmutedAt);
      for (const t of startsOn(fresh)) expect(t).toBeGreaterThanOrEqual(unmutedAt - 0.001);
    });

    it('starts on the theme chosen before the first gesture', () => {
      const e = engine();
      e.handle([start('2-1')]);
      press();
      runClock(1);
      expect(lanes()).toHaveLength(1);
      expect(e.theme).toBe('ionReach');
    });

    it('stops every bus with the player', () => {
      const e = playing();
      e.handle([start('2-1')]);
      runClock(6);
      e.dispose();
      expect(lanes()).toEqual([]);
    });
  });
});
