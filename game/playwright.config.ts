import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile-landscape',
      use: { ...devices['Pixel 5 landscape'] },
    },
  ],
  webServer: {
    // Specs drive the e2e build, which carries the test bridge. CI builds it in an earlier
    // step; locally, build first so preview is never stale.
    command: `${isCI ? '' : 'npm run build:e2e && '}npm run preview -- --outDir dist-e2e --port 4173 --strictPort`,
    url: 'http://localhost:4173',
    reuseExistingServer: !isCI,
    timeout: 60000,
  },
});
