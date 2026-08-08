import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:3000';

// Whether the target is actually remote — not merely whether BASE_URL was set.
//
// These used to key off `process.env.BASE_URL` being present at all, which conflated two
// unrelated things: "don't start a dev server for me" and "expect network latency". CI
// sets BASE_URL to localhost precisely to opt out of the managed webServer while still
// testing a local process, and inherited the 120s remote budget as a side effect. With
// one worker and no retries that turned a handful of failing tests into a 40-minute job
// timeout, which reads as an infrastructure problem rather than the test failure it was.
const isRemoteTarget = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseURL);

export default defineConfig({
  testDir: './e2e',
  // Remote targets are slower than a local server end to end: sign-in alone has been
  // measured at up to 37s against GCE + Cloud SQL, and beforeEach time counts against the
  // test budget. 60s left no headroom once the login wait was raised to match reality.
  timeout: isRemoteTarget ? 120_000 : 60_000,
  expect: {
    timeout: isRemoteTarget ? 20_000 : 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
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
