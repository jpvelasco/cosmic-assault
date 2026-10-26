import { describe, expect, it, vi } from 'vitest';
import { RingLog } from '../../src/platform/log';
import { registerServiceWorker } from '../../src/platform/serviceWorker';

function fakeNavigator(register: (url: string) => Promise<unknown>): Navigator {
  return { serviceWorker: { register } } as unknown as Navigator;
}

describe('registerServiceWorker', () => {
  it('registers ./sw.js with the default scope', () => {
    const register = vi.fn(() => Promise.resolve({}));
    const log = new RingLog();
    registerServiceWorker(fakeNavigator(register), log);
    expect(register).toHaveBeenCalledWith('./sw.js');
    expect(log.size).toBe(0);
  });

  it('logs a failure, with what to do, instead of throwing', async () => {
    const log = new RingLog();
    registerServiceWorker(fakeNavigator(() => Promise.reject(new Error('blocked'))), log);
    await vi.waitFor(() => {
      expect(log.size).toBe(1);
    });
    const [entry] = log.entries();
    expect(entry?.kind).toBe('error');
    expect(entry?.message).toMatch(/offline play is unavailable.*blocked.*reload/i);
  });

  it('does nothing where the browser has no service workers', () => {
    const log = new RingLog();
    expect(() => {
      registerServiceWorker({} as Navigator, log);
    }).not.toThrow();
    expect(log.size).toBe(0);
  });
});
