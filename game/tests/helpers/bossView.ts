import type { BossView } from '../../src/sim/boss/behaviour';

/**
 * A boss in the fight with every field of the view filled in: the test fixture at (640, 100), facing down, with nothing
 * to shoot at (`target` null) though its core can be hurt. `over` replaces fields; its pose before the last step
 * (`px`, `py`) follows its position unless it says otherwise.
 */
export function bossView(over: Partial<BossView> = {}): BossView {
  const { x = 640, y = 100 } = over;
  return { id: 'monolith', x, y, px: x, py: y, radius: 70, hp: 20, maxHp: 20, phase: 1, state: 'fighting', windup: null, active: null, vulnerable: true, parts: [], facing: Math.PI / 2, target: null, threat: null, aim: { x: 640, y: 600 }, opening: 0, ...over };
}
