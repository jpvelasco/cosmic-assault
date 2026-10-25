import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  // e2e builds include the test bridge, so they never share dist/ with the release build.
  build: mode === 'e2e' ? { outDir: 'dist-e2e' } : {},
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
