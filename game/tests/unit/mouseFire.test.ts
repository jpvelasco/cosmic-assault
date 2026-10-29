import { describe, expect, it, vi } from 'vitest';
import { attachMouseFire } from '../../src/input/mouseFire';

const MOUSE = 1;

function pointer(type: string, init: { pointerType?: string; button?: number; buttons?: number; pointerId?: number } = {}): Event {
  return Object.assign(new Event(type), { pointerType: 'mouse', button: 0, buttons: 1, pointerId: MOUSE, ...init });
}

/** The canvas, a window and a document as fakes, with the pointer capture the canvas holds. */
function setup() {
  const captured = new Set<number>();
  const surface = Object.assign(new EventTarget(), {
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
    hasPointerCapture: (id: number) => captured.has(id),
  });
  const win = new EventTarget();
  const shown: { visibilityState: DocumentVisibilityState } = { visibilityState: 'visible' };
  const doc = Object.assign(new EventTarget(), shown);
  const state = { playing: true };
  const mouse = attachMouseFire(surface, win, doc, () => state.playing);
  const press = (init?: Parameters<typeof pointer>[1]): void => {
    surface.dispatchEvent(pointer('pointerdown', init));
  };
  return { surface, captured, win, doc, state, mouse, press };
}

describe('attachMouseFire', () => {
  it('fires while the primary button is held on the field, and stops on its release', () => {
    const { surface, captured, mouse, press } = setup();
    expect(mouse.fire).toBe(false);
    press();
    expect(mouse.fire).toBe(true);
    expect(captured.has(MOUSE)).toBe(true);
    surface.dispatchEvent(pointer('pointerup', { buttons: 0 }));
    expect(mouse.fire).toBe(false);
    expect(captured.size).toBe(0);
  });

  it.each([
    ['a cancelled pointer', 'pointercancel'],
    ['a lost capture', 'lostpointercapture'],
  ])('lets go on %s', (_name, type) => {
    const { surface, mouse, press } = setup();
    press();
    surface.dispatchEvent(pointer(type));
    expect(mouse.fire).toBe(false);
  });

  it('lets go when the primary button is let go while another is still held, which sends no pointerup', () => {
    const { surface, mouse, press } = setup();
    press();
    surface.dispatchEvent(pointer('pointermove', { buttons: 1 }));
    expect(mouse.fire).toBe(true);
    surface.dispatchEvent(pointer('pointermove', { button: 0, buttons: 2 }));
    expect(mouse.fire).toBe(false);
  });

  it.each(['blur', 'contextmenu'])('lets go on a %s of the window', (type) => {
    const { win, mouse, press } = setup();
    press();
    win.dispatchEvent(new Event(type));
    expect(mouse.fire).toBe(false);
  });

  it('lets go when the tab is hidden, not when it shows', () => {
    const { doc, mouse, press } = setup();
    press();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(mouse.fire).toBe(true);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(mouse.fire).toBe(false);
  });

  it('lets go on release(), as a pause, a screen change or a new run does, and a button still held fires only once pressed again', () => {
    const { surface, captured, mouse, press } = setup();
    press();
    mouse.release();
    expect(mouse.fire).toBe(false);
    expect(captured.size).toBe(0);
    surface.dispatchEvent(pointer('pointermove'));
    expect(mouse.fire).toBe(false);
    press();
    expect(mouse.fire).toBe(true);
  });

  it('never fires from a press outside play, nor from one still held once play starts', () => {
    const { surface, state, mouse, press } = setup();
    state.playing = false;
    press();
    expect(mouse.fire).toBe(false);
    expect(surface.setPointerCapture).not.toHaveBeenCalled();
    state.playing = true;
    surface.dispatchEvent(pointer('pointermove'));
    expect(mouse.fire).toBe(false);
  });

  it.each([
    ['a finger', { pointerType: 'touch' }],
    ['a pen', { pointerType: 'pen' }],
    ['the middle button', { button: 1, buttons: 4 }],
    ['the right button', { button: 2, buttons: 2 }],
  ])('ignores %s', (_name, init) => {
    const { surface, mouse, press } = setup();
    press(init);
    expect(mouse.fire).toBe(false);
    expect(surface.setPointerCapture).not.toHaveBeenCalled();
  });

  it('ignores a press on anything but the field: a button, a card, the touch layer or the pause button never reach it', () => {
    const { win, mouse } = setup();
    const button = new EventTarget();
    button.dispatchEvent(pointer('pointerdown'));
    win.dispatchEvent(pointer('pointerdown'));
    expect(mouse.fire).toBe(false);
  });

  it('lets go and stops listening once disposed', () => {
    const { captured, mouse, press } = setup();
    press();
    mouse.dispose();
    expect(mouse.fire).toBe(false);
    expect(captured.size).toBe(0);
    press();
    expect(mouse.fire).toBe(false);
  });
});
