import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../../src/app/commands';
import { GAME_OVER_GUARD_MS } from '../../src/app/gameOverGuard';
import { actsUnder, anyCoverUp, commandActs, coversFor, createInputRouter, inputForCommand, type Cover, type RoutedInput } from '../../src/app/inputRouting';
import type { PadSnapshot } from '../../src/input/gamepad';
import { createKeyLatch } from '../../src/input/keyLatch';

const UNCOVERED = { settings: false, records: false, hangar: false, rotate: false, crash: false };
const NO_COVER = coversFor(UNCOVERED);

describe('coversFor', () => {
  it('is none when nothing covers the cards', () => {
    expect(NO_COVER).toEqual(['none']);
  });

  it('lists every card that is up, settings or records under the rotate prompt included', () => {
    expect(coversFor({ ...UNCOVERED, settings: true })).toEqual(['settings']);
    expect(coversFor({ ...UNCOVERED, settings: true, rotate: true })).toEqual(['settings', 'rotate']);
    expect(coversFor({ ...UNCOVERED, records: true, rotate: true })).toEqual(['records', 'rotate']);
    expect(coversFor({ ...UNCOVERED, hangar: true })).toEqual(['hangar']);
    expect(coversFor({ ...UNCOVERED, hangar: true, rotate: true })).toEqual(['hangar', 'rotate']);
    expect(coversFor({ ...UNCOVERED, rotate: true, crash: true })).toEqual(['rotate', 'crash']);
  });
});

describe('actsUnder', () => {
  // The review's matrix, row by row: which inputs act under which cover.
  it.each<[RoutedInput, none: boolean, settings: boolean, records: boolean, hangar: boolean, rotate: boolean, crash: boolean]>([
    ['start', true, false, false, false, false, false],
    ['resume', true, false, false, false, false, false],
    ['pause', true, false, false, false, true, false],
    ['leave', true, false, false, false, true, false],
    ['toggleMute', true, true, true, true, true, false],
    ['toggleFullscreen', true, true, true, true, true, true],
    ['navigate', true, true, true, true, false, false],
    ['pressFocused', true, true, true, true, false, false],
    ['closeCard', true, true, true, true, false, false],
  ])('%s: none %s, settings %s, records %s, hangar %s, rotate %s, crash %s', (input, none, settings, records, hangar, rotate, crash) => {
    const under = (cover: Cover) => actsUnder(input, [cover]);
    expect([under('none'), under('settings'), under('records'), under('hangar'), under('rotate'), under('crash')]).toEqual([none, settings, records, hangar, rotate, crash]);
  });

  it('needs every cover that is up to allow the input', () => {
    // M acts under settings and under the rotate prompt, so it acts under both; Esc closing settings does not.
    expect(actsUnder('toggleMute', ['settings', 'rotate'])).toBe(true);
    expect(actsUnder('closeCard', ['settings', 'rotate'])).toBe(false);
    expect(actsUnder('closeCard', ['records', 'rotate'])).toBe(false);
    expect(actsUnder('closeCard', ['hangar', 'rotate'])).toBe(false);
    // Leaving a card acts under the rotate prompt alone, but not when the settings card is open beneath it.
    expect(actsUnder('leave', ['settings', 'rotate'])).toBe(false);
  });
});

describe('inputForCommand', () => {
  it('splits togglePause into a pause in play and a resume otherwise', () => {
    const toggle: Command = { kind: 'togglePause' };
    expect(inputForCommand(toggle, 'playing')).toBe('pause');
    expect(inputForCommand(toggle, 'paused')).toBe('resume');
  });

  it.each<Command>([
    { kind: 'start' },
    { kind: 'resumeRank' },
    { kind: 'chooseMode', mode: 'rank' },
    { kind: 'openDimension', dimension: 2 },
    { kind: 'openGalaxy', id: '1-1' },
    { kind: 'confirm' },
    { kind: 'next' },
    { kind: 'retry' },
    { kind: 'continue' },
  ])('routes %j, which goes forward and may start a run, as start', (command) => {
    expect(inputForCommand(command, 'title')).toBe('start');
  });

  it.each<Command>([{ kind: 'back' }, { kind: 'map' }, { kind: 'title' }])('routes %j, which leaves a card, as leave', (command) => {
    expect(inputForCommand(command, 'gameOver')).toBe('leave');
  });

  it('names mute and full screen by their kind', () => {
    expect(inputForCommand({ kind: 'toggleMute' }, 'playing')).toBe('toggleMute');
    expect(inputForCommand({ kind: 'toggleFullscreen' }, 'paused')).toBe('toggleFullscreen');
  });
});

describe('commandActs', () => {
  const start: Command = { kind: 'start' };

  it('runs a command the covers allow', () => {
    expect(commandActs(start, 'title', NO_COVER, 0)).toBe(true);
  });

  it('holds a command a cover blocks', () => {
    expect(commandActs(start, 'title', ['rotate'], 0)).toBe(false);
    expect(commandActs({ kind: 'togglePause' }, 'paused', ['rotate'], 0)).toBe(false);
    expect(commandActs({ kind: 'togglePause' }, 'playing', ['rotate'], 0)).toBe(true);
  });

  it('waits out the game-over guard on the end cards', () => {
    const retry: Command = { kind: 'retry' };
    for (const screen of ['results', 'gameOver', 'rankComplete'] as const) {
      expect(commandActs(retry, screen, NO_COVER, GAME_OVER_GUARD_MS - 1)).toBe(false);
      expect(commandActs(retry, screen, NO_COVER, GAME_OVER_GUARD_MS)).toBe(true);
    }
  });
});

/** A standard-mapping pad snapshot with `buttons` held and the left stick at `stick`. */
function padWith(buttons: readonly number[] = [], stick: readonly [number, number] = [0, 0]): PadSnapshot {
  return { axes: [...stick, 0, 0], pressed: Array.from({ length: 17 }, (_, i) => buttons.includes(i)) };
}

const PAD_A = 0;

/** A key event as a browser dispatches it, on a window stand-in. */
function keyEvent(type: 'keydown' | 'keyup', code: string, { repeat = false, ctrlKey = false } = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat, ctrlKey, metaKey: false, altKey: false });
}

/**
 * A router on a window stand-in, with a demo playing until the first input ends it; `later` is a listener added after
 * the router's, as the game's own key and pointer handling are, which sees whatever the router lets through.
 */
function demoRouter() {
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } }, activeElement: null });
  const win = new EventTarget();
  let demoPlaying = true;
  const interrupt = vi.fn(() => {
    const ended = demoPlaying;
    demoPlaying = false;
    return ended;
  });
  const run = { flow: vi.fn(), pause: vi.fn(), resume: vi.fn(), toggleMute: vi.fn(), toggleFullscreen: vi.fn() };
  const router = createInputRouter(win as unknown as Window, {
    keyboard: { held: new Set(), drainPressed: () => [], dispose: () => undefined },
    startKeys: createKeyLatch(),
    run,
    screen: () => 'title',
    covers: () => ['none'],
    msSinceRunEnd: () => Number.POSITIVE_INFINITY,
    menuControls: () => [],
    closeCard: () => undefined,
    interrupt,
  });
  const later = vi.fn();
  for (const type of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'mouseup', 'click']) win.addEventListener(type, later);
  /** Dispatches `event`; true if it got past the router to `later`. */
  const reaches = (event: Event): boolean => {
    later.mockClear();
    win.dispatchEvent(event);
    return later.mock.calls.length > 0;
  };
  return { win, router, run, interrupt, reaches, startDemo: () => (demoPlaying = true) };
}

describe('the input that ends an attract demo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('swallows the key press, its repeats and its release, so a held key never reaches the next screen; the next press acts', () => {
    const { reaches, interrupt } = demoRouter();
    const press = keyEvent('keydown', 'Enter');
    expect(reaches(press)).toBe(false);
    expect(press.defaultPrevented).toBe(true);
    expect(interrupt).toHaveBeenCalledTimes(1);
    const repeat = keyEvent('keydown', 'Enter', { repeat: true });
    expect(reaches(repeat)).toBe(false);
    expect(repeat.defaultPrevented).toBe(true);
    const release = keyEvent('keyup', 'Enter');
    expect(reaches(release)).toBe(false);
    expect(release.defaultPrevented).toBe(true);
    const next = keyEvent('keydown', 'Enter');
    expect(reaches(next)).toBe(true);
    expect(next.defaultPrevented).toBe(false);
  });

  it('keeps F from changing full screen when it ends the demo', () => {
    const { win, run } = demoRouter();
    win.dispatchEvent(keyEvent('keydown', 'KeyF'));
    expect(run.toggleFullscreen).not.toHaveBeenCalled();
    win.dispatchEvent(keyEvent('keyup', 'KeyF'));
    win.dispatchEvent(keyEvent('keydown', 'KeyF'));
    expect(run.toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('lets a key through when no demo plays, still restarting the idle count', () => {
    const { reaches, interrupt } = demoRouter();
    reaches(keyEvent('keydown', 'Space'));
    const press = keyEvent('keydown', 'KeyM');
    expect(reaches(press)).toBe(true);
    expect(press.defaultPrevented).toBe(false);
    expect(interrupt).toHaveBeenCalledTimes(2);
  });

  it('ends the demo on a browser shortcut but leaves the shortcut its browser action', () => {
    const { reaches, interrupt } = demoRouter();
    const shortcut = keyEvent('keydown', 'KeyR', { ctrlKey: true });
    expect(reaches(shortcut)).toBe(true);
    expect(shortcut.defaultPrevented).toBe(false);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(reaches(keyEvent('keyup', 'KeyR'))).toBe(true);
  });

  it('treats a fresh press of a key whose release it missed as a new press', () => {
    const { reaches } = demoRouter();
    reaches(keyEvent('keydown', 'Enter'));
    expect(reaches(keyEvent('keydown', 'Enter'))).toBe(true);
  });

  it('swallows the mouse presses and the click a demo-ending pointer press leads to; the next click acts', () => {
    const { reaches, interrupt } = demoRouter();
    expect(reaches(new Event('pointerdown'))).toBe(true);
    expect(interrupt).toHaveBeenCalledTimes(1);
    for (const type of ['mousedown', 'mouseup', 'click']) {
      const event = new Event(type, { cancelable: true });
      expect(reaches(event), type).toBe(false);
      expect(event.defaultPrevented, type).toBe(true);
    }
    expect(reaches(new Event('click'))).toBe(true);
    reaches(new Event('pointerdown'));
    expect(reaches(new Event('click'))).toBe(true);
  });

  it('lets a later click through after a demo-ending press that never became one, once any other input comes', () => {
    const { reaches, router } = demoRouter();
    reaches(new Event('pointerdown'));
    reaches(keyEvent('keydown', 'Enter'));
    expect(reaches(new Event('click'))).toBe(true);
    reaches(new Event('pointerdown'));
    router.routePad(padWith([PAD_A]), [], 0);
    expect(reaches(new Event('click'))).toBe(true);
  });

  it('swallows a pad press that ends the demo, and a button still held from it; the next press acts', () => {
    const { router, run, interrupt } = demoRouter();
    router.routePad(padWith([PAD_A]), ['confirm'], 0);
    expect(interrupt).toHaveBeenCalledTimes(1);
    router.routePad(padWith([PAD_A]), [], 0);
    router.routePad(padWith(), [], 0);
    expect(run.flow).not.toHaveBeenCalled();
    router.routePad(padWith([PAD_A]), ['confirm'], 0);
    expect(run.flow).toHaveBeenCalledWith({ kind: 'start' });
  });

  it('ends the demo on a stick pushed past its dead zone, short of a menu move, and acts on the next press', () => {
    const { router, run, interrupt } = demoRouter();
    router.routePad(padWith([], [0.3, 0]), [], 0);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveLastReturnedWith(true);
    router.routePad(padWith(), [], 0);
    router.routePad(padWith([PAD_A]), ['confirm'], 0);
    expect(run.flow).toHaveBeenCalledWith({ kind: 'start' });
  });

  it('counts a pad at rest as no input', () => {
    const { router, interrupt } = demoRouter();
    router.routePad(padWith(), [], 0);
    router.routePad(null, [], 0);
    expect(interrupt).not.toHaveBeenCalled();
  });

  it('forgets a held key and a pending click when the window loses focus', () => {
    const { reaches, win, startDemo } = demoRouter();
    reaches(keyEvent('keydown', 'Enter'));
    win.dispatchEvent(new Event('blur'));
    expect(reaches(keyEvent('keydown', 'Enter', { repeat: true }))).toBe(true);
    startDemo();
    reaches(new Event('pointerdown'));
    win.dispatchEvent(new Event('blur'));
    expect(reaches(new Event('click'))).toBe(true);
  });
});

describe('anyCoverUp', () => {
  it('agrees with coversFor on every cover', () => {
    expect(anyCoverUp(UNCOVERED)).toBe(false);
    for (const cover of Object.keys(UNCOVERED) as (keyof typeof UNCOVERED)[]) expect(anyCoverUp({ ...UNCOVERED, [cover]: true }), cover).toBe(true);
  });
});
