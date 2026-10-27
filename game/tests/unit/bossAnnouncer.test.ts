import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBossAnnouncer } from '../../src/ui/bossAnnouncer';

interface FakeEl {
  className: string;
  textContent: string;
  readonly attrs: Map<string, string>;
  setAttribute(name: string, value: string): void;
  readonly remove: ReturnType<typeof vi.fn>;
}

function fakeElement(): FakeEl {
  const attrs = new Map<string, string>();
  return {
    className: '',
    textContent: '',
    attrs,
    setAttribute: (name, value) => attrs.set(name, value),
    remove: vi.fn(),
  };
}

describe('createBossAnnouncer', () => {
  let made: FakeEl[];
  const root = { append: vi.fn() } as unknown as HTMLElement;

  beforeEach(() => {
    made = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const el = fakeElement();
        made.push(el);
        return el;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a visually hidden status region, so the canvas boss bar has words', () => {
    createBossAnnouncer(root);
    const [el] = made;
    expect(el?.attrs.get('role')).toBe('status');
    expect(el?.className).toBe('visually-hidden');
  });

  it('says when the boss arrives, at each phase and when it goes down, and nothing for other events', () => {
    const announcer = createBossAnnouncer(root);
    const el = made[0];
    announcer.handle([{ type: 'shot', x: 0, y: 0 }]);
    expect(el?.textContent).toBe('');
    announcer.handle([{ type: 'bossIntro', id: 'sentinel' }]);
    expect(el?.textContent).toBe('Sentinel approaches');
    announcer.handle([{ type: 'bossHit', x: 0, y: 0, hp: 13 }, { type: 'bossPhase', phase: 2 }]);
    expect(el?.textContent).toBe('Sentinel, phase 2 of 3');
    announcer.handle([{ type: 'bossPhase', phase: 3 }]);
    expect(el?.textContent).toBe('Sentinel, phase 3 of 3');
    announcer.handle([{ type: 'bossDown', id: 'sentinel' }]);
    expect(el?.textContent).toBe('Sentinel down');
  });

  it('says when the boss\'s core is laid bare and shielded again, and nothing for its parts or deflected shots', () => {
    const announcer = createBossAnnouncer(root);
    const el = made[0];
    announcer.handle([{ type: 'bossIntro', id: 'sentinel' }]);
    announcer.handle([{ type: 'bossPartHit', part: 0, x: 0, y: 0, hp: 1 }, { type: 'bossPartBroken', part: 0, x: 0, y: 0 }, { type: 'bossDeflected', x: 0, y: 0 }]);
    expect(el?.textContent).toBe('Sentinel approaches');
    announcer.handle([{ type: 'bossExposed', x: 0, y: 0 }]);
    expect(el?.textContent).toBe('Sentinel\'s core is exposed');
    announcer.handle([{ type: 'bossShielded', x: 0, y: 0 }]);
    expect(el?.textContent).toBe('Sentinel\'s core is shielded again');
  });

  it('says when the Hive Carrier\'s hangar opens and closes', () => {
    const announcer = createBossAnnouncer(root);
    const el = made[0];
    announcer.handle([{ type: 'bossIntro', id: 'hiveCarrier' }]);
    announcer.handle([{ type: 'hangarOpen', x: 0, y: 0 }]);
    expect(el?.textContent).toBe('Hive Carrier\'s hangar is open');
    announcer.handle([{ type: 'hangarClose', x: 0, y: 0 }]);
    expect(el?.textContent).toBe('Hive Carrier\'s hangar is closed');
  });

  it('names the Warden as it arrives, through its phases and as it goes down', () => {
    const announcer = createBossAnnouncer(root);
    const el = made[0];
    announcer.handle([{ type: 'bossIntro', id: 'warden' }]);
    expect(el?.textContent).toBe('Warden approaches');
    announcer.handle([{ type: 'bossPhase', phase: 3 }]);
    expect(el?.textContent).toBe('Warden, phase 3 of 3');
    announcer.handle([{ type: 'bossDown', id: 'warden' }]);
    expect(el?.textContent).toBe('Warden down');
  });

  it('clears its text as a galaxy starts, so a retry announces the same boss again', () => {
    const announcer = createBossAnnouncer(root);
    const el = made[0];
    announcer.handle([{ type: 'bossIntro', id: 'sentinel' }]);
    announcer.handle([{ type: 'bossDown', id: 'sentinel' }]);
    announcer.handle([{ type: 'galaxyStart', id: '1-6' }]);
    expect(el?.textContent).toBe('');
    announcer.handle([{ type: 'bossIntro', id: 'sentinel' }]);
    expect(el?.textContent).toBe('Sentinel approaches');
  });

  it('leaves the page on dispose', () => {
    createBossAnnouncer(root).dispose();
    expect(made[0]?.remove).toHaveBeenCalledOnce();
  });
});
