// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for Cosmic Assault tests.
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './specs',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI for more predictable results
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL - can be overridden by CI with deployed preview URL
    baseURL: process.env.TEST_URL || 'http://localhost:8080',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Capture screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording for debugging
    video: process.env.CI ? 'on-first-retry' : 'off',
  },

  // Configure projects for major browsers and mobile
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 }
      },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 }
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 }
      },
    },
    // Mobile viewports (landscape for game)
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5 landscape'],
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 12 Pro landscape'],
      },
    },
  ],

  // Run local dev server before starting the tests (when not using deployed URL)
  webServer: process.env.TEST_URL ? undefined : {
    command: 'npx serve ../website -p 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
