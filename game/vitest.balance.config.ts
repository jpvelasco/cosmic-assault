import { defineConfig } from 'vitest/config';

// The slow, many-seed bot runs (boss kill rates, clear rates): out of `npm test`, run by `npm run test:balance` and CI's
// non-required balance job.
export default defineConfig({
  test: { include: ['tests/balance/**/*.test.ts'], environment: 'node' },
});
