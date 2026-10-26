import { describe, expect, it, vi } from 'vitest';
import { createPickupNotices } from '../../src/app/pickupNotices';
import type { PickupId } from '../../src/content/types';
import type { SimEvent } from '../../src/sim/events';

const dropped = (kind: PickupId, id = 1): SimEvent => ({ type: 'pickupDropped', id, kind, x: 0, y: 0 });
const collected = (kind: PickupId, id = 1): SimEvent => ({ type: 'pickupCollected', id, kind });

function setup(seen: PickupId[] = []) {
  const notify = vi.fn<(text: string) => void>();
  const markSeen = vi.fn((kind: PickupId) => {
    seen.push(kind);
  });
  const notices = createPickupNotices({ seen: () => seen, markSeen, notify });
  return { notices, notify, markSeen, seen };
}

describe('createPickupNotices', () => {
  it('says what a kind does the first time it drops', () => {
    const { notices, notify } = setup();
    notices.handle([dropped('doubleShot')]);
    expect(notify).toHaveBeenCalledExactlyOnceWith('New: Double Shot — two shots at once');
  });

  it('has a line for every kind', () => {
    const { notices, notify } = setup();
    for (const kind of ['weaponCore', 'doubleShot', 'shield', 'rapidFire', 'spreadLaser'] as const) notices.handle([dropped(kind)]);
    expect(notify.mock.calls.map(([text]) => text)).toEqual([
      'New: Weapon Core — a stronger volley for good',
      'New: Double Shot — two shots at once',
      'New: Shield — absorbs one hit',
      'New: Rapid Fire — shoot faster',
      'New: Spread Laser — a fan of three shots',
    ]);
  });

  it('says nothing for a kind the player has collected before', () => {
    const { notices, notify } = setup(['shield']);
    notices.handle([dropped('shield')]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('says it once a run, not on every drop of an uncollected kind', () => {
    const { notices, notify } = setup();
    notices.handle([dropped('shield', 1)]);
    notices.handle([dropped('shield', 2)]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('says it again in the next run if the kind was never collected', () => {
    const { notices, notify } = setup();
    notices.handle([dropped('shield')]);
    notices.newRun();
    notices.handle([dropped('shield')]);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('counts a kind as seen once it is collected, not merely dropped', () => {
    const { notices, markSeen } = setup();
    notices.handle([dropped('doubleShot')]);
    expect(markSeen).not.toHaveBeenCalled();
    notices.handle([collected('doubleShot')]);
    expect(markSeen).toHaveBeenCalledExactlyOnceWith('doubleShot');
  });

  it('marks a kind once however often it is collected, and stops its callout for good', () => {
    const { notices, markSeen, notify } = setup();
    notices.handle([collected('shield', 1)]);
    notices.handle([collected('shield', 2)]);
    expect(markSeen).toHaveBeenCalledTimes(1);
    notices.newRun();
    notices.handle([dropped('shield')]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('ignores every other event', () => {
    const { notices, notify, markSeen } = setup();
    notices.handle([{ type: 'shot', x: 0, y: 0 }, { type: 'pickupExpired', id: 1 }, { type: 'effectEnded', kind: 'shield' }, { type: 'shieldBroken' }]);
    expect(notify).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
  });
});
