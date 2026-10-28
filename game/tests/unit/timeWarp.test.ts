import { describe, expect, it } from 'vitest';
import { galaxyById } from '../../src/content/galaxies';
import { MIN_WINDUP_SECONDS } from '../../src/content/pacingRules';
import type { GalaxyDef } from '../../src/content/types';
import { bossTarget } from '../../src/sim/boss/bossRules';
import { PICKUP, STEP_SECONDS, TIME_WARP_SCALE } from '../../src/sim/config';
import { NO_CONTROLS } from '../../src/sim/controls';
import { World } from '../../src/sim/world';
import { calmGalaxy } from '../helpers/mute';
import { practiceScript } from '../helpers/practiceLog';
import { placeFoe } from '../helpers/foeRig';

const FIELD = { width: 1280, height: 720 };
const DT = STEP_SECONDS;

function world(galaxy: GalaxyDef, opts: { readonly rocks?: readonly { x: number; y: number; size: 0 | 1 | 2 | 3; angle: number; speedMultiplier: number }[] } = {}): World {
  return new World({ seed: 4, field: FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' }, ...(opts.rocks === undefined ? {} : { initialAsteroids: opts.rocks }) });
}


/** Keeps Time Warp running (collecting it again refreshes its clock) and, if `untouchable`, the ship out of every collision. */
function hold(w: World, warp: boolean, untouchable = false): void {
  if (warp) w['run']?.loadout.collect('timeWarp');
  if (untouchable) Object.assign(w['shipState'], { invulnerable: true, invulnerableFor: 99 });
}

describe('Time Warp', () => {
  it('scales the enemies\' time by 0.5 while it runs, and by 1 again once its 8 s are up', () => {
    const w = world(calmGalaxy('5-2'));
    const run = w['run'];
    expect(run?.enemyTimeScale()).toBe(1);
    run?.loadout.collect('timeWarp');
    expect(run?.enemyTimeScale()).toBe(TIME_WARP_SCALE);
    expect(TIME_WARP_SCALE).toBe(0.5);
    for (let i = 0; i < Math.round(8 / DT); i++) w.step(DT, NO_CONTROLS);
    expect(run?.enemyTimeScale()).toBe(1);
  });

  it('moves rocks and foes half as far, and the pickups, the clock and the ship\'s shots as far as ever', () => {
    const moved = (warp: boolean) => {
      const w = world(calmGalaxy('5-2'), { rocks: [{ x: 300, y: 200, size: 1, angle: 0.4, speedMultiplier: 1 }] });
      const run = w['run'];
      if (run === null) throw new Error('not a galaxy');
      const foe = placeFoe(run['foes'], 'splitter', 900, 500, { vx: 60, vy: -30 });
      run['pickupField'].list.push({ id: 1, kind: 'shield', x: 100, y: 600, px: 100, py: 600, vx: 20, vy: 0, expiresIn: PICKUP.lifespan });
      if (warp) run.loadout.collect('timeWarp');
      const rock = w.asteroids[0];
      const before = { rock: { x: rock?.x ?? 0, y: rock?.y ?? 0 }, foe: { x: foe.x, y: foe.y }, time: w.timeLeft ?? 0 };
      w.step(DT, { ...NO_CONTROLS, fire: true });
      const shot = w.projectiles[0];
      return {
        rock: Math.hypot((rock?.x ?? 0) - before.rock.x, (rock?.y ?? 0) - before.rock.y),
        foe: Math.hypot(foe.x - before.foe.x, foe.y - before.foe.y),
        pickup: (w.pickups[0]?.x ?? 0) - 100,
        clock: before.time - (w.timeLeft ?? 0),
        shot: { x: shot?.x, y: shot?.y },
      };
    };
    const plain = moved(false);
    const warped = moved(true);
    expect(warped.rock).toBeCloseTo(plain.rock * 0.5, 9);
    expect(warped.foe).toBeCloseTo(plain.foe * 0.5, 9);
    expect(plain.rock).toBeGreaterThan(0);
    expect(warped.pickup).toBe(plain.pickup);
    expect(warped.clock).toBe(plain.clock);
    expect(warped.shot).toEqual(plain.shot);
  });

  it('leaves the ship\'s poses byte-identical to a run without it, through a gravity well\'s pull', () => {
    const fly = (warp: boolean) => {
      const w = world(galaxyById('2-2'));
      const poses: string[] = [];
      const rocks: string[] = [];
      let pulled = false;
      for (let step = 0; step < Math.round(45 / DT); step++) {
        hold(w, warp, true);
        w.step(DT, practiceScript(step));
        const { x, y, vx, vy, angle, px, py, pangle } = w.ship;
        poses.push(JSON.stringify([x, y, vx, vy, angle, px, py, pangle]));
        rocks.push(JSON.stringify(w.asteroids.map((a) => [a.x, a.y])));
        pulled ||= w.hazards.some((h) => h.stage === 'active');
      }
      return { poses, rocks, pulled };
    };
    const plain = fly(false);
    const warped = fly(true);
    expect(warped.pulled).toBe(true);
    expect(warped.rocks).not.toEqual(plain.rocks);
    expect(warped.poses).toEqual(plain.poses);
  });

  describe('in a boss fight', () => {
    /** The real seconds from each `bossWindup` to its attack going active, in a 1-★ fight with the ship untouchable. */
    function windups(warp: boolean, seconds: number): { attack: string; real: number }[] {
      const w = world(galaxyById('1-6'));
      const found: { attack: string; real: number }[] = [];
      let open: { attack: string; at: number } | null = null;
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        hold(w, warp, true);
        for (const e of w.step(DT, NO_CONTROLS)) if (e.type === 'bossWindup') open = { attack: e.attack, at: w.elapsed };
        if (open !== null && w.boss?.active != null) {
          found.push({ attack: open.attack, real: w.elapsed - open.at });
          open = null;
        }
      }
      return found;
    }

    it('counts a windup in the boss\'s slowed time, so in real time it lasts twice as long, never under 0.35 s', () => {
      const plain = windups(false, 70);
      const warped = windups(true, 70);
      expect(warped.length).toBeGreaterThan(2);
      warped.forEach((w, i) => {
        const p = plain[i];
        expect(w.attack, `windup ${String(i)}`).toBe(p?.attack);
        expect(w.real, `windup ${String(i)}`).toBeCloseTo((p?.real ?? 0) / TIME_WARP_SCALE, 1);
        expect(w.real, `windup ${String(i)}`).toBeGreaterThanOrEqual(MIN_WINDUP_SECONDS);
      });
    });

    it('lets a boss beaten under it die in real time, so it is down as the galaxy clears', () => {
      const w = world(galaxyById('1-6'));
      const run = w['run'];
      if (run === null) throw new Error('not a galaxy');
      for (let i = 0; i < Math.round(60 / DT) && w.status !== 'cleared'; i++) {
        hold(w, true, true);
        const boss = w.boss;
        if (boss !== null) for (let t = bossTarget(boss); t !== null; t = bossTarget(boss)) run.bosses.hitBoss(t.x, t.y, 1);
        w.step(DT, NO_CONTROLS);
      }
      expect(w.status).toBe('cleared');
      expect(w.boss?.state).toBe('down');
    });
  });
});
