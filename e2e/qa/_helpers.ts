/**
 * Shared harness for the parallel QA lane run.
 *
 * Throwaway QA scaffolding — not part of the committed e2e suite.
 *
 * Every lane must call `attachRecorders(page, LANE)` in beforeEach and
 * `recorder.flush()` in afterEach, otherwise that lane produces no console /
 * network evidence and its findings cannot be verified.
 */
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PASSWORD } from './personas';

export const RUN_DATE = process.env.QA_RUN_DATE ?? '2026-08-03';

/** Page loads slower than this are worth recording — QA doc rule 5. */
export const SLOW_LOAD_MS = 3000;

/** Repo-root-relative output dir for a lane, created on demand. */
export function laneDir(lane: string, ...parts: string[]): string {
  const dir = path.join(process.cwd(), 'qa-runs', RUN_DATE, lane, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export type ConsoleEntry = { at: string; url: string; type: string; text: string };
export type NetworkEntry = { at: string; status: number; method: string; url: string };
export type NavEntry = { at: string; path: string; ms: number; finalUrl: string };

export type Recorder = {
  consoleErrors: ConsoleEntry[];
  pageErrors: ConsoleEntry[];
  failedRequests: NetworkEntry[];
  navigations: NavEntry[];
  /** Writes the collected evidence to qa-runs/<date>/<lane>/logs/<label>.json. */
  flush(label: string): string;
};

/**
 * Wires console + network capture onto a page. Returns the live buffers so a
 * test can assert on them mid-run (e.g. "this click produced a 500").
 */
export function attachRecorders(page: Page, lane: string): Recorder {
  const rec: Recorder = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    navigations: [],
    flush(label: string) {
      const file = path.join(laneDir(lane, 'logs'), `${slug(label)}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            lane,
            label,
            runDate: RUN_DATE,
            counts: {
              consoleErrors: rec.consoleErrors.length,
              pageErrors: rec.pageErrors.length,
              failedRequests: rec.failedRequests.length,
              slowNavigations: rec.navigations.filter((n) => n.ms > SLOW_LOAD_MS).length,
            },
            consoleErrors: rec.consoleErrors,
            pageErrors: rec.pageErrors,
            failedRequests: rec.failedRequests,
            navigations: rec.navigations,
          },
          null,
          2
        )
      );
      return file;
    },
  };

  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    rec.consoleErrors.push({
      at: new Date().toISOString(),
      url: page.url(),
      type: msg.type(),
      text: msg.text().slice(0, 2000),
    });
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
    const status = res.status();
    if (status < 400) return;
    rec.failedRequests.push({
      at: new Date().toISOString(),
      status,
      method: res.request().method(),
      url: res.url(),
    });
  });

  return rec;
}

/**
 * Logs in and waits until the app has navigated off /login.
 *
 * Prefers the dev-only one-click Demo Accounts button (app/login/page.tsx:87-101)
 * and falls back to the credentials form. Retries because a cold Next dev server
 * compiles the route on first hit and can blow the default wait.
 */
export async function login(page: Page, email: string, password: string = PASSWORD): Promise<void> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });

      const demoBtn = page.locator('button', { hasText: email }).first();
      if (await demoBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await demoBtn.click();
      } else {
        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');
      }

      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 25000 });
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `login failed for ${email} after 3 attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

/** Clears the session so the next login starts clean. */
export async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
}

/**
 * Navigates and records how long it took plus where it actually landed.
 * Use this instead of page.goto so redirects and slow loads end up in the log.
 *
 * Timings from a parallel wave are NOT valid perf evidence — three browsers share
 * one Next dev process. Perf is a separate serial pass.
 */
export async function gotoTimed(page: Page, pathname: string, rec: Recorder): Promise<NavEntry> {
  const started = Date.now();
  await page.goto(pathname, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const entry: NavEntry = {
    at: new Date().toISOString(),
    path: pathname,
    ms: Date.now() - started,
    finalUrl: page.url(),
  };
  rec.navigations.push(entry);
  return entry;
}

/**
 * Explicit screenshot. The Playwright config only auto-captures on failure, so
 * confusing-but-passing UX moments need this called by hand.
 */
export async function shot(page: Page, lane: string, name: string): Promise<string> {
  const file = path.join(laneDir(lane, 'screenshots'), `${slug(name)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(process.cwd(), file);
}

/**
 * Reads the role the session actually resolved to. context/AppContext.tsx:37
 * falls back to 'sdr' while the session loads, so a guard that reads role too
 * early can bounce the wrong way — compare this against the expected role.
 */
export async function sessionRole(page: Page): Promise<string | null> {
  const res = await page.request.get('/api/auth/session');
  if (!res.ok()) return null;
  const body = (await res.json().catch(() => null)) as { user?: { role?: string } } | null;
  return body?.user?.role ?? null;
}

/** Appends one row to the lane's running findings scratch file. */
export function note(lane: string, line: string): void {
  const file = path.join(laneDir(lane), 'notes.md');
  fs.appendFileSync(file, `${line}\n`);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
