import { test, expect } from '@playwright/test';

// Sign-in round-trip budget. 10s was enough against a local dev server but is marginal
// against a deployment: on the GCE + Cloud SQL box the same leadgen login measured
// anywhere from under 10s to 37s, so a fixed 10s made the suite fail roughly one run in
// three with a timeout that looked like an auth bug. Credentials were never the problem —
// POSTing them directly returns 302 with a valid session every time.
const LOGIN_TIMEOUT = process.env.BASE_URL ? 45_000 : 15_000;

// The seeded demo password. This used to be the literal `telestar2026`, repeated at six
// call sites, which meant the suite only ran against a database seeded with that exact
// published string. CI now mints a random DEMO_SEED_PASSWORD per run and passes it here
// as E2E_PASSWORD, so hardcoding it made every persona login fail — and with one worker
// and no retries, six serial failures walked the job into its timeout.
//
// **No fallback.** This used to default to the literal `telestar2026` when the variable was
// unset. That string is published in this repository and is still the password on every
// non-Director demo account on the live box, so a default silently authenticated with a
// credential anyone can read — and §1 of the audit brief forbids reusing it. Failing loudly is
// better than quietly signing in with a published password.
function requiredPassword(): string {
  const value = process.env.E2E_PASSWORD;
  if (!value) {
    throw new Error(
      'E2E_PASSWORD is required. Pass the password for the seeded demo accounts explicitly; ' +
        'there is deliberately no default.'
    );
  }
  return value;
}
const PASSWORD = requiredPassword();


/**
 * Open a route and assert it actually rendered.
 *
 * §48 of the audit brief asks which assertions would still pass if the feature were broken.
 * For this file the answer was "most of them": of 29 assertions, **24 were `toHaveURL`** — they
 * confirm the browser navigated, and nothing else. A route whose every API call returned 500,
 * or which rendered Next's error boundary, satisfied every one of them.
 *
 * Every route in the CRM paints exactly one `<h1>` (`.claude/rules/brand-design.md` makes that
 * a rule, and it was verified across all 18 routes before this helper was written), so
 * requiring a visible heading and the absence of an error boundary turns a navigation check
 * into a render check without coupling the test to any particular page's content.
 */
async function gotoRendered(page: import('@playwright/test').Page, route: string, urlPattern: RegExp | string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(urlPattern);
  await expect(
    page.locator('text=/Application error|Unhandled Runtime Error|500 - Internal/i').first(),
    `${route} rendered an error boundary`
  ).toHaveCount(0);
  await expect(page.locator('h1').first(), `${route} painted no heading`).toBeVisible();
}

test.describe('Role-Based E2E Persona Journeys & Navigation', () => {
  test('Unauthenticated user is redirected to login', async ({ page }) => {
    await gotoRendered(page, '/', /.*login/);
    await expect(page.locator('text=Telestar CRM')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  // ─── 1. DIRECTOR JOURNEY ──────────────────────────────────────────────
  test.describe('1. Director Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const directorBtn = page.locator('button', { hasText: 'dean@telestar.vn' });
      if (await directorBtn.isVisible()) {
        await directorBtn.click();
      } else {
        await page.fill('input[type="email"]', 'dean@telestar.vn');
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT });
    });

    test('Director has full executive access across all modules', async ({ page }) => {
      // Step 1: Director Cockpit
      await page.goto('/director');
      await expect(page.locator('h1', { hasText: 'Director Cockpit' })).toBeVisible();

      // Step 2: Team View & Floor Leaderboard
      await gotoRendered(page, '/team', /.*team/);

      // Step 3: Opportunities & Revenue Forecasting
      await gotoRendered(page, '/opportunities', /.*opportunities/);

      // Step 4: Client Performance Reports
      await gotoRendered(page, '/client-reports', /.*client-reports/);

      // Step 5: Deliverability & Email Health
      await gotoRendered(page, '/email-health', /.*email-health/);

      // Step 6: Leadgen Manager Hub
      await gotoRendered(page, '/leadgen-manager', /.*leadgen-manager/);
    });
  });

  // ─── 2. FLOOR MANAGER JOURNEY ─────────────────────────────────────────
  test.describe('2. Floor Manager Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const fmBtn = page.locator('button', { hasText: 'sonny@telestar.vn' });
      if (await fmBtn.isVisible()) {
        await fmBtn.click();
      } else {
        await page.fill('input[type="email"]', 'sonny@telestar.vn');
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT });
    });

    test('Floor Manager accesses team supervision, meetings, and deliverability', async ({ page }) => {
      // Step 1: Team Floor Hub
      await gotoRendered(page, '/team', /.*team/);

      // Step 2: Leads Pipeline Oversight
      await gotoRendered(page, '/leads', /.*leads/);

      // Step 3: Meetings & Quality Control
      await gotoRendered(page, '/meetings', /.*meetings/);

      // Step 4: Deliverability Management
      await gotoRendered(page, '/email-health', /.*email-health/);

      // Step 5: Leadgen Manager Data Pool
      await gotoRendered(page, '/leadgen-manager', /.*leadgen-manager/);
    });
  });

  // ─── 3. TEAM LEAD JOURNEY ─────────────────────────────────────────────
  test.describe('3. Team Lead Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const tlBtn = page.locator('button', { hasText: 'brandon@telestar.vn' });
      if (await tlBtn.isVisible()) {
        await tlBtn.click();
      } else {
        await page.fill('input[type="email"]', 'brandon@telestar.vn');
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT });
    });

    test('Team Lead supervises pod tasks and sequence executions', async ({ page }) => {
      // Step 1: Daily Task Board
      await gotoRendered(page, '/', '/');

      // Step 2: Leads pipeline
      await gotoRendered(page, '/leads', /.*leads/);

      // Step 3: Sequences cadences
      await gotoRendered(page, '/sequences', /.*sequences/);

      // Step 4: Meetings
      await gotoRendered(page, '/meetings', /.*meetings/);
    });
  });

  // ─── 4. SDR JOURNEY ───────────────────────────────────────────────────
  test.describe('4. SDR Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const sdrBtn = page.locator('button', { hasText: 'lan.pham@telestar.vn' });
      if (await sdrBtn.isVisible()) {
        await sdrBtn.click();
      } else {
        await page.fill('input[type="email"]', 'lan.pham@telestar.vn');
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT });
    });

    test('SDR executes focused daily task queue and is gated from executive hubs', async ({ page }) => {
      // Step 1: Task Dashboard
      await gotoRendered(page, '/', '/');

      // Step 2: Leads pipeline
      await gotoRendered(page, '/leads', /.*leads/);

      // Step 3: Meetings view
      await gotoRendered(page, '/meetings', /.*meetings/);

      // Step 4: Unified Inbox
      await gotoRendered(page, '/inbox', /.*inbox/);

      // Step 5: Director Cockpit Gated
      await page.goto('/director');
      await expect(page).not.toHaveURL(/.*director/);

      // Step 6: Team Floor Gated
      await page.goto('/team');
      await expect(page).not.toHaveURL(/.*team/);
    });
  });

  // ─── 5. LEADGEN SPECIALIST JOURNEY ────────────────────────────────────
  test.describe('5. Leadgen Specialist Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const leadgenBtn = page.locator('button', { hasText: 'alex@telestar.vn' });
      if (await leadgenBtn.isVisible()) {
        await leadgenBtn.click();
      } else {
        await page.fill('input[type="email"]', 'alex@telestar.vn');
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT });
    });

    test('Leadgen Specialist auto-routes to /leadgen prospecting workbench', async ({ page }) => {
      // Step 1: Navigating to / auto-redirects to /leadgen
      await gotoRendered(page, '/', /.*leadgen/);

      // Step 2: Gated from manager ecosystem
      await page.goto('/leadgen-manager');
      await expect(page).not.toHaveURL(/.*leadgen-manager/);
    });
  });

  // ─── 6. LEADGEN MANAGER JOURNEY ───────────────────────────────────────
  test.describe('6. Leadgen Manager Persona Journey', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      const lgMgrBtn = page.locator('button', { hasText: 'dominic@telestar.vn' });
      if (await lgMgrBtn.isVisible()) {
        await lgMgrBtn.click();
      } else {
        await page.fill('input[type="email"]', 'dominic@telestar.vn');
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
      }
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_TIMEOUT });
    });

    test('Leadgen Manager has access to 7-tab database ecosystem', async ({ page }) => {
      await gotoRendered(page, '/leadgen-manager', /.*leadgen-manager/);

      // Mirrors the TABS array in app/leadgen-manager/page.tsx. Importing is a
      // header action ("Import to Internal DB") that opens a modal, not a tab —
      // this test previously looked for an "Import Center" tab that no longer exists.
      for (const label of [
        'Overview',
        'Internal Database',
        'Qualification Queue',
        'Campaign Routing',
        'Export Center',
        'Team Performance',
        'Source Performance',
      ]) {
        await expect(page.locator('button', { hasText: label }).first()).toBeVisible();
      }

      await expect(page.locator('button', { hasText: 'Import to Internal DB' })).toBeVisible();
    });
  });
});
