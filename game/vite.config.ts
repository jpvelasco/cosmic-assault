import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
