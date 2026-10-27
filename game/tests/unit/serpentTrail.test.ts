import { describe, expect, it } from 'vitest';
import type { BossPart } from '../../src/sim/boss/behaviour';
import { SerpentTrail } from '../../src/sim/boss/serpentTrail';
import { rescale } from '../../src/sim/wrap';

const parts = (count: number): BossPart[] => Array.from({ length: count }, () => ({ x: 0, y: 0, px: 0, py: 0, radius: 10, hp: 1, maxHp: 1 }));
const poses = (list: readonly BossPart[]): [number, number][] => list.map((p) => [p.x, p.y]);

describe('a serpent trail', () => {
  it('lays the parts, tail first, a gap apart along the way the head came', () => {
    const trail = new SerpentTrail(64, 4);
    for (let x = 0; x <= 300; x += 1) trail.follow(x, 100);
    const body = parts(3);
    trail.lay(300, 100, body, 40);
    expect(poses(body).map(([x, y]) => [Math.round(x * 1e6) / 1e6, y])).toEqual([[180, 100], [220, 100], [260, 100]]);
  });

  it('measures the gaps along the trail, round a bend, not straight back from the head', () => {
    const trail = new SerpentTrail(64, 4);
    // Up the y axis to (0, 100), then along x to (100, 100).
    for (let y = 0; y <= 100; y += 1) trail.follow(0, y);
    for (let x = 1; x <= 100; x += 1) trail.follow(x, 100);
    const body = parts(3);
    trail.lay(100, 100, body, 60);
    const [tail, middle, front] = body as [BossPart, BossPart, BossPart];
    expect([front.x, front.y]).toEqual([40, 100].map((v) => expect.closeTo(v, 6) as number));
    expect([middle.x, middle.y]).toEqual([0, 80].map((v) => expect.closeTo(v, 6) as number));
    expect([tail.x, tail.y]).toEqual([0, 20].map((v) => expect.closeTo(v, 6) as number));
  });

  it('notes a point only once the head has moved the step from the last, so a head that holds still keeps its body', () => {
    const trail = new SerpentTrail(16, 4);
    for (let x = 0; x <= 60; x += 1) trail.follow(x, 0);
    for (let i = 0; i < 1000; i++) trail.follow(60 + (i % 2) * 0.5, 0);
    const body = parts(1);
    trail.lay(60, 0, body, 40);
    expect(body[0]?.x).toBeCloseTo(20, 6);
  });

  it('leaves a part it has no trail for at the oldest point it has', () => {
    const trail = new SerpentTrail(64, 4);
    for (let x = 0; x <= 50; x += 1) trail.follow(x, 0);
    const body = parts(2);
    trail.lay(50, 0, body, 40);
    expect(body.map((p) => p.x)).toEqual([0, 10].map((x) => expect.closeTo(x, 6) as number));
    expect(body.map((p) => p.y)).toEqual([0, 0]);
  });

  it('keeps no more than its capacity, the oldest points overwritten', () => {
    const trail = new SerpentTrail(8, 4);
    for (let x = 0; x <= 400; x += 4) trail.follow(x, 0);
    const body = parts(1);
    trail.lay(400, 0, body, 100);
    // Eight points, 4 apart, reach back 28 from the newest.
    expect(body[0]?.x).toBeCloseTo(372, 6);
  });

  it('stretches every point it holds to a new field', () => {
    const trail = new SerpentTrail(64, 4);
    for (let x = 0; x <= 200; x += 1) trail.follow(x, 300);
    trail.rescale({ width: 1000, height: 600 }, { width: 2000, height: 300 });
    const [x, y] = [rescale(200, 1000, 2000), rescale(300, 600, 300)];
    const body = parts(1);
    trail.lay(x, y, body, 80);
    expect(poses(body)).toEqual([[expect.closeTo(x - 80, 6), expect.closeTo(y, 6)]]);
  });
});
