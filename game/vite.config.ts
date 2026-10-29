import { defineConfig } from 'vitest/config';
import { APP_VERSION } from './vite/appVersion.ts';
import { precachePlugin } from './vite/precache.ts';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [precachePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  // e2e builds include the test bridge, so they never share dist/ with the release build.
  build: mode === 'e2e' ? { outDir: 'dist-e2e' } : {},
  // tests/balance holds the slow bot runs, which vitest.balance.config.ts runs instead. A loaded host stretches a test
  // several times over, so the timeout leaves room past vitest's 5 s, and a test over 1.5 s is still flagged as slow.
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/balance/**'], environment: 'node', testTimeout: 15_000, slowTestThreshold: 1500 },
}));
