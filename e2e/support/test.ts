/**
 * The audit's `test` object. Import this, never `@playwright/test` directly.
 *
 * It adds two things every spec in this suite needs:
 *
 *   `recorder` — console errors, uncaught exceptions and failed requests, collected for the
 *                whole test and asserted at teardown. §5 of the audit brief requires that an
 *                unexpected console error or a silent 4xx/5xx fails the test rather than
 *                being noticed by nobody.
 *
 *   `expectFailures` — the opt-out. A negative-permission test *should* produce a 403, so it
 *                declares that up front. Declaring is the point: it turns "this 403 is fine"
 *                from an assumption into something written down and reviewable.
 */
import { test as base, expect, type Page } from '@playwright/test';

export type ConsoleEntry = { at: string; url: string; type: string; text: string };
export type NetworkEntry = { at: string; status: number; method: string; url: string };

export type Recorder = {
  consoleErrors: ConsoleEntry[];
  pageErrors: ConsoleEntry[];
  failedRequests: NetworkEntry[];
  /** Statuses this test legitimately expects, e.g. `[403]` for a negative-access check. */
  expectFailures(...statuses: number[]): void;
  /** URL substrings whose failures are this test's business, not a defect. */
  ignoreUrls(...fragments: string[]): void;
  /**
   * Console messages this test deliberately provokes.
   *
   * `ignoreUrls` cannot cover these: a console error is recorded against the *page* URL, not
   * the request that caused it, so a test that kills one request has no way to say so. A test
   * that aborts a fetch on purpose still owns the browser's complaint about it — and, as with
   * `expectFailures`, declaring which complaint turns an assumption into something reviewable.
   */
  ignoreConsole(...patterns: RegExp[]): void;
  /** Assert no unexpected console/network noise so far, without ending the test. */
  assertClean(label?: string): void;
};

/**
 * Browser noise that is not the application's fault. Kept deliberately short — every entry
 * is a hole in §5, so each one carries the reason it is here.
 */
const CONSOLE_ALLOWLIST: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /Download the React DevTools/i,
    reason: 'React dev-build advisory, not emitted by a production build',
  },
  {
    pattern: /\[Fast Refresh\]/i,
    reason: 'next dev hot-reload chatter; absent from a built app',
  },
];

/** Requests whose failure says nothing about the page under test. */
const NETWORK_ALLOWLIST: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\/_next\/static\/.*\.hot-update\./i,
    reason: 'dev-server hot-update probe races the navigation and 404s harmlessly',
  },
];

function attach(page: Page): Recorder {
  const expected = new Set<number>();
  const ignored: string[] = [];
  const ignoredConsole: RegExp[] = [];

  const rec: Recorder = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    expectFailures(...statuses) {
      statuses.forEach((s) => expected.add(s));
    },
    ignoreUrls(...fragments) {
      ignored.push(...fragments);
    },
    ignoreConsole(...patterns) {
      ignoredConsole.push(...patterns);
    },
    assertClean(label = 'page') {
      const console_ = rec.consoleErrors.filter(
        (entry) => !ignoredConsole.some((pattern) => pattern.test(entry.text)),
      );
      const errors = rec.pageErrors;
      const net = rec.failedRequests.filter(
        (r) => !expected.has(r.status) && !ignored.some((f) => r.url.includes(f))
      );
      expect(errors, `${label}: uncaught exceptions\n${fmt(errors)}`).toEqual([]);
      expect(console_, `${label}: console errors\n${fmt(console_)}`).toEqual([]);
      expect(net, `${label}: failed requests\n${fmt(net)}`).toEqual([]);
    },
  };

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const locUrl = msg.location()?.url || '';
    if (CONSOLE_ALLOWLIST.some((a) => a.pattern.test(text) || a.pattern.test(locUrl))) return;
    rec.consoleErrors.push({ at: new Date().toISOString(), url: page.url(), type: 'error', text: text.slice(0, 2000) });
  });

  page.on('pageerror', (err) => {
    rec.pageErrors.push({
      at: new Date().toISOString(),
      url: page.url(),
      type: 'pageerror',
      text: (err.stack ?? err.message).slice(0, 2000),
    });
  });

  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    if (NETWORK_ALLOWLIST.some((a) => a.pattern.test(url))) return;
    rec.failedRequests.push({
      at: new Date().toISOString(),
      status: res.status(),
      method: res.request().method(),
      url,
    });
  });

  return rec;
}

function fmt(entries: (ConsoleEntry | NetworkEntry)[]): string {
  return entries.map((e) => `  - ${JSON.stringify(e)}`).join('\n') || '  (none)';
}

export const test = base.extend<{ recorder: Recorder }>({
  recorder: async ({ page }, use) => {
    const rec = attach(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(rec);
    rec.assertClean('teardown');
  },
});

export { expect };
