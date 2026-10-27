import type { BossPart, BossView } from '../../src/sim/boss/behaviour';
import { TAU } from '../../src/sim/math';
import { WARDEN_RING } from '../../src/sim/boss/warden';

type Ringed = Readonly<Pick<BossView, 'x' | 'y' | 'parts'>>;

const bearingOf = (boss: Ringed, p: Readonly<BossPart>): number => Math.atan2(p.y - boss.y, p.x - boss.x);
/** The turn from `from` round to `to`, in [0, 2π). */
const turnTo = (from: number, to: number): number => (((to - from) % TAU) + TAU) % TAU;

/** The clear width between parts `a` and `b`, `b` the next live part round the ring: edge to edge, or the ring's whole width if they are half a turn or more apart. */
function across(boss: Ringed, a: Readonly<BossPart>, b: Readonly<BossPart>): number {
  const wide = turnTo(bearingOf(boss, a), bearingOf(boss, b)) >= Math.PI;
  const span = wide ? Math.hypot(a.x - boss.x, a.y - boss.y) + Math.hypot(b.x - boss.x, b.y - boss.y) : Math.hypot(b.x - a.x, b.y - a.y);
  return span - a.radius - b.radius;
}

/** The openings round a ring of parts about the core, from each live part, taken by bearing, to the next. */
export function ringGaps(boss: Ringed): number[] {
  const live = boss.parts.filter((p) => p.hp > 0).sort((a, b) => bearingOf(boss, a) - bearingOf(boss, b));
  if (live.length < 2) return [Infinity];
  return live.map((a, i) => across(boss, a, live[(i + 1) % live.length] as Readonly<BossPart>));
}

/** The width of the opening round the ring that bearing `at` passes through: between the live parts either side of it; open wide with fewer than two. */
export function openingAt(boss: Ringed, at: number): number {
  let before: Readonly<BossPart> | null = null;
  let after: Readonly<BossPart> | null = null;
  for (const p of boss.parts) {
    if (p.hp <= 0) continue;
    if (before === null || turnTo(bearingOf(boss, p), at) < turnTo(bearingOf(boss, before), at)) before = p;
    if (after === null || turnTo(at, bearingOf(boss, p)) < turnTo(at, bearingOf(boss, after))) after = p;
  }
  return before === null || after === null || before === after ? Infinity : across(boss, before, after);
}

/** The bearings of the Warden's two gap slots: the slot before turret 0's, and the one opposite. */
export function wardenGapBearings(boss: Ringed): [number, number] {
  const gap = bearingOf(boss, boss.parts[0] as BossPart) - TAU / WARDEN_RING.slots;
  return [gap, gap + Math.PI];
}

/** The width of the openings through the Warden's two gap slots, the narrower first. */
export function wardenGaps(boss: Ringed): [number, number] {
  const [a, b] = wardenGapBearings(boss).map((at) => openingAt(boss, at)) as [number, number];
  return a <= b ? [a, b] : [b, a];
}
