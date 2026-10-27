import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];
// Off Vite's default preview port (4173), so a stray `npm run preview` is never mistaken for these builds.
const E2E_URL = 'http://localhost:4317';
const RELEASE_URL = 'http://localhost:4318';
const desktopChrome = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } };

/** Serves a built `outDir`. CI builds it in an earlier step; locally, build first so preview is never stale. */
function previewServer(build: string, outDir: string, url: string) {
  const port = new URL(url).port;
  return {
    command: `${isCI ? '' : `npm run ${build} && `}npm run preview -- --outDir ${outDir} --port ${port} --strictPort`,
    url,
    reuseExistingServer: !isCI,
    timeout: 60000,
  };
}

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: E2E_URL,
  },
  // Tags pick a project where a spec runs in several: @desktop and @phone run only there, and @release also runs
  // against the release build. tests/unit/e2eProjects.test.ts checks that every spec keeps a test that runs.
  projects: [
    // These drive the e2e build, which carries the test bridge.
    {
      name: 'chromium-desktop',
      testMatch: ['**/smoke.spec.ts', '**/keyboard.spec.ts', '**/gameOver.spec.ts', '**/redraw.spec.ts', '**/quality.spec.ts', '**/audio.spec.ts', '**/crash.spec.ts', '**/fullscreen.spec.ts', '**/settings.spec.ts', '**/platform.spec.ts', '**/gamepad.spec.ts', '**/offline.spec.ts', '**/install.spec.ts', '**/menuKeys.spec.ts', '**/progression.spec.ts', '**/ionReach.spec.ts', '**/rank.spec.ts', '**/records.spec.ts', '**/pickups.spec.ts', '**/bosses.spec.ts'],
      grepInvert: /@phone/,
      use: desktopChrome,
    },
    {
      name: 'mobile-landscape',
      testMatch: ['**/smoke.spec.ts', '**/touch.spec.ts', '**/hud.spec.ts', '**/settings.spec.ts', '**/platform.spec.ts', '**/gamepad.spec.ts', '**/records.spec.ts', '**/ionReach.spec.ts'],
      grepInvert: /@desktop/,
      use: { ...devices['Pixel 5 landscape'] },
    },
    // Report-only frame times under a CPU slowdown. `npm run test:e2e` leaves this project out; run it with `npm run test:perf`.
    {
      name: 'perf',
      testMatch: '**/perf.spec.ts',
      retries: 0,
      use: desktopChrome,
    },
    // The release build has no bridge; these prove it boots cleanly without one and can be installed.
    {
      name: 'release-smoke',
      testMatch: ['**/release-smoke.spec.ts', '**/install.spec.ts'],
      grep: /@release/,
      use: { ...desktopChrome, baseURL: RELEASE_URL },
    },
  ],
  webServer: [previewServer('build:e2e', 'dist-e2e', E2E_URL), previewServer('build', 'dist', RELEASE_URL)],
});
