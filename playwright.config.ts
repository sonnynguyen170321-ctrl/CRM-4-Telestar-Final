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

/** The three root specs that predate the deep audit. CI and the post-deploy gate name them. */
const LEGACY_SPECS = [
  'crm-journeys.spec.ts',
  'deep-smoke.spec.ts',
  'user-flow-31step.spec.ts',
];

export default defineConfig({
  testDir: './e2e',
  // `e2e/qa/**` is self-labelled throwaway QA scaffolding (see its own header comments), not
  // part of any suite. Excluding it here stops it running by accident while it is still
  // useful as reference material.
  testIgnore: ['**/qa/**'],
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
    // `on-first-retry` with `retries: 0` meant traces were never captured at all, so a
    // failure produced no artifact to investigate — which §49 of the audit brief requires.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Signs in once per role and writes playwright/.auth/<role>.json.
      name: 'setup',
      testMatch: /support[\\/]auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // The deep audit. 1440x900 is the primary desktop viewport per §4; the 1024 and
      // sub-1024 cases are exercised by the desktop-gate spec, which sets its own sizes —
      // running every spec at three viewports would triple the run for no extra signal.
      name: 'audit',
      dependencies: ['setup'],
      testMatch: /e2e[\\/](auth|roles|leads|sequences|email|meetings|opportunities|reports|admin|journeys|resilience)[\\/].*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // The demo walkthrough. Its own project because the audit's testMatch does not cover
      // `e2e/demo`, and a spec matched by no project silently never runs — which is exactly
      // what happened to automation-journeys.spec.ts before it moved.
      //
      // No `setup` dependency on purpose: the demo tenant has its own users, seeded by
      // `npm run demo:seed`, and the spec signs in over the API itself. Depending on the audit
      // fixture would make the walkthrough fail for a reason that has nothing to do with the demo.
      name: 'demo',
      testMatch: /e2e[\\/]demo[\\/].*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Pre-existing suite, untouched. Kept at its original 1280x800 deliberately: these
      // specs pass today and CI gates on them, so the audit does not get to change the
      // conditions under which they were verified.
      name: 'chromium',
      // Globs, not a constructed RegExp. The previous version escaped dots by hand with
      // `.replace(/./g, …)`, which CodeQL flags as `js/incomplete-sanitization` — and it is
      // right that hand-rolled escaping is the wrong tool for building a pattern. Playwright
      // matches globs natively, so there is nothing to escape.
      testMatch: LEGACY_SPECS.map((file) => `**/e2e/${file}`),
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
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
