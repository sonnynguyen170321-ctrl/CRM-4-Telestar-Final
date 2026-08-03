import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Remote targets are slower than a local dev server end to end: sign-in alone has been
  // measured at up to 37s against GCE + Cloud SQL, and beforeEach time counts against the
  // test budget. 60s left no headroom once the login wait was raised to match reality.
  timeout: process.env.BASE_URL ? 120_000 : 60_000,
  expect: {
    timeout: process.env.BASE_URL ? 20_000 : 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Only boot a local dev server when no BASE_URL was supplied. Without this guard the
  // suite still waits on http://localhost:3000 even when pointed at a deployment, so
  // running it as a post-deploy gate either hangs or silently tests the wrong target.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node "node_modules/next/dist/bin/next" dev -p 3000',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120 * 1000,
      },
});
