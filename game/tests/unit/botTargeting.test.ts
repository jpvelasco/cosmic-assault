import { describe, expect, it } from 'vitest';
import { createCasual, REACTION_SECONDS } from '../../src/bot/casual';
import { chooseTarget, leadHeading, type Target } from '../../src/bot/targeting';
import { createView, readView, type BotView } from '../../src/bot/view';
import { galaxyById } from '../../src/content/galaxies';
import type { FoeKind } from '../../src/content/types';
import type { BossView, Point } from '../../src/sim/boss/behaviour';
import { PLAYER, STEP_SECONDS } from '../../src/sim/config';
import type { Foe } from '../../src/sim/foes/foe';
import { createRng } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { SCENE_FIELD, sceneView, stillRock } from '../helpers/botScene';

function foe(kind: FoeKind, x: number, y: number): Foe {
  return { id: 0, kind, x, y, vx: 0, vy: 0, px: x, py: y, rotation: 0, protation: 0, spin: 0, radius: 12, hp: 1 };
}

/** A boss whose behaviour names `target` as where a shot does harm. */
function boss(target: Point | null, state: BossView['state'] = 'fighting'): BossView {
  const vulnerable = target !== null;
  return { id: 'sentinel', x: 640, y: 100, px: 640, py: 100, radius: 70, hp: 20, maxHp: 20, phase: 1, state, windup: null, active: null, vulnerable, parts: [], facing: Math.PI / 2, target };
}

const target = (): Target => ({ x: 0, y: 0, vx: 0, vy: 0 });

function chosen(view: BotView): Target | null {
  const out = target();
  return chooseTarget(view, out) ? out : null;
}

describe('bot targeting', () => {
  it('chooses nothing on an empty field', () => {
    expect(chosen(sceneView())).toBeNull();
  });

  it('shoots a drone before a nearer rock, and a near rock before a far splitter', () => {
    const view = sceneView([stillRock(740, 360)]);
    view.foes = [foe('drone', 640, 660)];
    expect(chosen(view)).toMatchObject({ x: 640, y: 660 });
    view.foes = [foe('splitter', 1100, 360)];
    expect(chosen(view)).toMatchObject({ x: 740, y: 360 });
  });

  it('aims where its boss says a shot does harm, off the core included, and at none of it outside the fight', () => {
    const view = sceneView();
    view.boss = boss({ x: 640, y: 160 });
    expect(chosen(view)).toMatchObject({ x: 640, y: 160 });
    view.boss = boss(null);
    expect(chosen(view)).toBeNull();
    view.boss = boss({ x: 640, y: 100 }, 'intro');
    expect(chosen(view)).toBeNull();
  });

  it('leads a crossing target so a shot meets it, and aims across the wrap', () => {
    const view = sceneView();
    const crossing = { x: 640 + 450, y: 360, vx: 0, vy: 225 };
    const heading = leadHeading(view, crossing);
    const t = 450 / (PLAYER.projectileSpeed * Math.cos(heading));
    expect(Math.sin(heading) * PLAYER.projectileSpeed * t).toBeCloseTo(225 * t, 6);
    const acrossEdge = { x: 20, y: 360, vx: 0, vy: 0 };
    view.ship = { ...view.ship, x: 1260 };
    expect(leadHeading(view, acrossEdge)).toBeCloseTo(0, 9);
  });
});

describe('the casual bot', () => {
  it('acts 0.3 s late: its first decisions send nothing', () => {
    const galaxy = galaxyById('1-1');
    const world = new World({ seed: 2, field: SCENE_FIELD, rules: { kind: 'galaxy', galaxy, mode: 'free' } });
    const bot = createCasual(createRng(1));
    const view = createView(world);
    const delay = Math.round(REACTION_SECONDS / STEP_SECONDS);
    let firstInput = -1;
    for (let i = 0; i < 2 * delay && firstInput < 0; i++) {
      const controls = bot.decide(readView(world, view));
      if (controls.fire || controls.turn !== 0 || controls.stick !== null) firstInput = i;
      world.step(STEP_SECONDS, controls);
    }
    expect(firstInput).toBe(delay);
  });
});
