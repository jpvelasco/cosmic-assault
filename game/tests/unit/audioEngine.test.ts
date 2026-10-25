import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, type AudioEngine } from '../../src/audio/engine';
import { DEFAULT_SETTINGS, type Settings } from '../../src/app/settings';
import type { SimEvent } from '../../src/sim/events';

class FakeParam {
  value = 0;
  readonly setValueAtTime = vi.fn();
  readonly linearRampToValueAtTime = vi.fn();
  readonly exponentialRampToValueAtTime = vi.fn();
  readonly setTargetAtTime = vi.fn();
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
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  sampleRate = 8000;
  readonly nodes: FakeNode[] = [];
  readonly destination = new FakeNode('destination');
  readonly resume = vi.fn(() => {
    this.state = 'running';
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
  createGain = () => this.make('gain');
  createBiquadFilter = () => this.make('biquad');
  createDynamicsCompressor = () => this.make('compressor');
  createOscillator = () => this.make('oscillator');
  createBufferSource = () => this.make('bufferSource');
}

const SHOT: SimEvent = { type: 'shot', x: 0, y: 0 };
let visibility: 'visible' | 'hidden';
let win: EventTarget;
let doc: EventTarget;

function press(type: 'keydown' | 'pointerdown' = 'keydown'): void {
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
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    expect(e.state).toBe('running');
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
    engine({ muted: false, musicVolume: 0.5, sfxVolume: 0.25 });
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
    for (const name of ['shoot', 'boomLarge', 'boomMedium', 'boomSmall', 'boomTiny', 'shipHit', 'gameOver', 'uiClick', 'pause'] as const) {
      e.play(name);
    }
    const voices = [...nodesOf('oscillator'), ...nodesOf('bufferSource')];
    expect(voices.length).toBeGreaterThan(9);
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
    const fixed = new Set([...nodesOf('gain').slice(0, 3), nodesOf('biquad')[0], nodesOf('compressor')[0]]);
    const connected = c.nodes.filter((n) => !fixed.has(n) && n.outputs.size > 0);
    expect(connected).toEqual([]);
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
    expect(ctx().resume).toHaveBeenCalledTimes(2);
  });

  it('stays suspended on return while muted, and wakes on unmute', () => {
    const e = engine();
    press();
    e.setMuted(true);
    setVisibility('hidden');
    setVisibility('visible');
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    e.setMuted(false);
    expect(ctx().resume).toHaveBeenCalledTimes(2);
  });

  it('ignores visibility changes before any gesture', () => {
    engine();
    setVisibility('hidden');
    setVisibility('visible');
    expect(contexts).toHaveLength(0);
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
