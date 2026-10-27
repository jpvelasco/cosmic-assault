import { defineConfig } from 'vitest/config';

// The slow, many-seed bot runs (the difficulty targets per galaxy, boss kill rates): out of `npm test`, run by
// `npm run test:balance` and CI's non-required balance job. tableSetup prints the table of rates after every run.
export default defineConfig({
  test: { include: ['tests/balance/**/*.test.ts'], environment: 'node', globalSetup: ['tests/balance/tableSetup.ts'] },
});
