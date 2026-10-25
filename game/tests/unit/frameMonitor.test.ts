import { describe, expect, it } from 'vitest';
import { FrameMonitor } from '../../src/app/frameMonitor';
import { WARMUP_MS } from '../../src/render/quality';

function warmedUp(): FrameMonitor {
  const monitor = new FrameMonitor();
  for (let i = 0; i < WARMUP_MS / 10; i++) monitor.sample(10);
  return monitor;
}

describe('FrameMonitor', () => {
  it('summarises nothing as zeros', () => {
    expect(new FrameMonitor().summary()).toEqual({ count: 0, p50: 0, p95: 0, longFrames: 0 });
  });

  it('excludes the first 3 s of frame time', () => {
    const monitor = new FrameMonitor();
    for (let i = 0; i < 299; i++) monitor.sample(10);
    expect(monitor.summary().count).toBe(0);
    monitor.sample(10);
    expect(monitor.summary().count).toBe(0);
    monitor.sample(10);
    expect(monitor.summary().count).toBe(1);
  });

  it('keeps long frames out of the stats while warming up', () => {
    const monitor = new FrameMonitor();
    monitor.sample(2999);
    monitor.sample(400);
    expect(monitor.summary()).toEqual({ count: 0, p50: 0, p95: 0, longFrames: 0 });
  });

  it('reports the median and 95th percentile by nearest rank', () => {
    const monitor = warmedUp();
    for (let ms = 1; ms <= 100; ms++) monitor.sample(ms);
    const { count, p50, p95 } = monitor.summary();
    expect(count).toBe(100);
    expect(p50).toBe(50);
    expect(p95).toBe(95);
  });

  it('is not skewed by sample order', () => {
    const monitor = warmedUp();
    for (let ms = 100; ms >= 1; ms--) monitor.sample(ms);
    expect(monitor.summary()).toMatchObject({ p50: 50, p95: 95 });
  });

  it('counts frames of 50 ms or more as long', () => {
    const monitor = warmedUp();
    for (const ms of [16, 49.9, 50, 80, 300]) monitor.sample(ms);
    expect(monitor.summary().longFrames).toBe(3);
  });

  it('can be read repeatedly and keeps counting', () => {
    const monitor = warmedUp();
    monitor.sample(20);
    expect(monitor.summary().count).toBe(1);
    monitor.sample(30);
    expect(monitor.summary().count).toBe(2);
  });

  it('starts a fresh warm-up after reset', () => {
    const monitor = warmedUp();
    monitor.sample(20);
    monitor.reset();
    expect(monitor.summary().count).toBe(0);
    monitor.sample(20);
    expect(monitor.summary().count).toBe(0);
  });

  it('ignores negative and NaN frame times', () => {
    const monitor = warmedUp();
    monitor.sample(-5);
    monitor.sample(Number.NaN);
    expect(monitor.summary().count).toBe(0);
  });
});
