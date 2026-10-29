import { describe, expect, it, vi } from 'vitest';
import { FrameMonitor, SLOW_FRAME_INTERVALS, STALL_MS } from '../../src/app/frameMonitor';
import { WARMUP_MS } from '../../src/render/quality';

const VSYNC_60_MS = 1000 / 60;
const VSYNC_30_MS = 1000 / 30;

function warmedUp(): FrameMonitor {
  const monitor = new FrameMonitor();
  for (let i = 0; i < WARMUP_MS / 10; i++) monitor.sample(10, VSYNC_60_MS);
  return monitor;
}

describe('FrameMonitor', () => {
  it('summarises nothing as zeros', () => {
    expect(new FrameMonitor().summary()).toEqual({ count: 0, p50: 0, p95: 0, longFrames: 0, slowShare: 0 });
  });

  it('excludes the first 3 s of frame time', () => {
    const monitor = new FrameMonitor();
    for (let i = 0; i < 299; i++) monitor.sample(10, VSYNC_60_MS);
    expect(monitor.summary().count).toBe(0);
    monitor.sample(10, VSYNC_60_MS);
    expect(monitor.summary().count).toBe(0);
    monitor.sample(10, VSYNC_60_MS);
    expect(monitor.summary().count).toBe(1);
  });

  it('keeps long frames out of the stats while warming up', () => {
    const monitor = new FrameMonitor();
    monitor.sample(2999, VSYNC_60_MS);
    monitor.sample(400, VSYNC_60_MS);
    expect(monitor.summary()).toEqual({ count: 0, p50: 0, p95: 0, longFrames: 0, slowShare: 0 });
  });

  it('reports the median and 95th percentile by nearest rank', () => {
    const monitor = warmedUp();
    for (let ms = 1; ms <= 100; ms++) monitor.sample(ms, VSYNC_60_MS);
    const { count, p50, p95 } = monitor.summary();
    expect(count).toBe(100);
    expect(p50).toBe(50);
    expect(p95).toBe(95);
  });

  it('is not skewed by sample order', () => {
    const monitor = warmedUp();
    for (let ms = 100; ms >= 1; ms--) monitor.sample(ms, VSYNC_60_MS);
    expect(monitor.summary()).toMatchObject({ p50: 50, p95: 95 });
  });

  it('counts frames of 50 ms or more as long', () => {
    const monitor = warmedUp();
    for (const ms of [16, 49.9, 50, 80, 300]) monitor.sample(ms, VSYNC_60_MS);
    expect(monitor.summary().longFrames).toBe(3);
  });

  it('reports the share of frames over 1.5 display intervals as slow', () => {
    expect(SLOW_FRAME_INTERVALS).toBe(1.5);
    const monitor = warmedUp();
    for (const ms of [16, 20, 25, 25.01, 33, 80, 16, 16]) monitor.sample(ms, VSYNC_60_MS);
    expect(monitor.summary().slowShare).toBe(3 / 8);
  });

  it('judges each frame against the interval it was given, so a 30 Hz display is not all slow', () => {
    const monitor = warmedUp();
    for (let i = 0; i < 9; i++) monitor.sample(VSYNC_30_MS, VSYNC_30_MS);
    monitor.sample(51, VSYNC_30_MS);
    expect(monitor.summary().slowShare).toBe(1 / 10);
    monitor.sample(VSYNC_30_MS, VSYNC_60_MS);
    expect(monitor.summary().slowShare).toBe(2 / 11);
  });

  it('counts no slow frames while warming up, and forgets them on reset', () => {
    const monitor = new FrameMonitor();
    monitor.sample(WARMUP_MS - 1, VSYNC_60_MS);
    monitor.sample(400, VSYNC_60_MS);
    monitor.sample(10, VSYNC_60_MS);
    expect(monitor.summary()).toMatchObject({ count: 1, slowShare: 0 });
    monitor.sample(100, VSYNC_60_MS);
    expect(monitor.summary().slowShare).toBe(1 / 2);
    monitor.reset();
    expect(monitor.summary().slowShare).toBe(0);
  });

  it('can be read repeatedly and keeps counting', () => {
    const monitor = warmedUp();
    monitor.sample(20, VSYNC_60_MS);
    expect(monitor.summary().count).toBe(1);
    monitor.sample(30, VSYNC_60_MS);
    expect(monitor.summary().count).toBe(2);
  });

  it('starts a fresh warm-up after reset', () => {
    const monitor = warmedUp();
    monitor.sample(20, VSYNC_60_MS);
    monitor.reset();
    expect(monitor.summary().count).toBe(0);
    monitor.sample(20, VSYNC_60_MS);
    expect(monitor.summary().count).toBe(0);
  });

  it('ignores negative and NaN frame times', () => {
    const monitor = warmedUp();
    monitor.sample(-5, VSYNC_60_MS);
    monitor.sample(Number.NaN, VSYNC_60_MS);
    expect(monitor.summary().count).toBe(0);
  });

  describe('stall callback', () => {
    it('reports a frame longer than 1000 ms, even while warming up', () => {
      const onStall = vi.fn();
      const monitor = new FrameMonitor(onStall);
      monitor.sample(STALL_MS + 1, VSYNC_60_MS);
      expect(onStall).toHaveBeenCalledExactlyOnceWith(STALL_MS + 1);
    });

    it('ignores frames up to 1000 ms and invalid times', () => {
      const onStall = vi.fn();
      const monitor = new FrameMonitor(onStall);
      monitor.sample(STALL_MS, VSYNC_60_MS);
      monitor.sample(Number.NaN, VSYNC_60_MS);
      monitor.sample(-5, VSYNC_60_MS);
      expect(onStall).not.toHaveBeenCalled();
    });

    it('counts a stall as a long frame', () => {
      const monitor = warmedUp();
      monitor.sample(2000, VSYNC_60_MS);
      expect(monitor.summary().longFrames).toBe(1);
    });
  });
});
