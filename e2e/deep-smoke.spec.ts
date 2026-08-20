import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Deep smoke sweep — drives every route as every persona and fails on any
 * server error, uncaught exception, or console error.
 *
 * Complements crm-journeys.spec.ts: that file asserts a persona *can reach* its
 * routes, this one asserts nothing is broken once it gets there. Together they
 * form the pre-deployment gate.
 *
 * Run against a deployment:
 *   BASE_URL=https://... E2E_PASSWORD=... npx playwright test deep-smoke
 *
 * The demo quick-login buttons are stripped from production bundles
 * (app/login/page.tsx gates them on NODE_ENV), so this file always drives the
 * email/password form — the one path that exists in every environment.
 */

// No default. `telestar2026` is published in this repository and is still live on every
// non-Director demo account on the deployed box; defaulting to it means a bare `npx playwright
// test` silently authenticates with a credential anyone can read. Fail loudly instead.
function requiredPassword(): string {
  const value = process.env.E2E_PASSWORD;
  if (!value) throw new Error('E2E_PASSWORD is required — there is deliberately no default.');
  return value;
}
const PASSWORD = requiredPassword();

// A persona sweep opens ~18 routes in one test. Against a dev server each route
// is compiled on first hit, which alone can exceed the default per-test budget.
test.describe.configure({ timeout: 300_000 });

/** Console noise that is expected and must not fail a run. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /React Router Future Flag/i,
  /Warning: Extra attributes from the server/i,
  /favicon\.ico/i,
];

type Persona = {
  label: string;
  email: string;
  /** Routes this persona must be able to open without error. */
  allowed: string[];
  /** Routes this persona must be bounced away from. */
  denied: string[];
};

const DASHBOARD_ROUTES = ['/', '/leads', '/meetings', '/sequences', '/templates', '/settings', '/inbox'];

const PERSONAS: Persona[] = [
  {
    label: 'Director',
    email: 'dean@telestar.vn',
    allowed: [
      ...DASHBOARD_ROUTES,
      '/director',
      '/team',
      '/opportunities',
      '/client-reports',
      '/email-health',
      '/leadgen-manager',
      '/automation',
      '/sequences/performance',
      // Admin Control Center — people ops.
      '/admin',
      '/admin/users',
      '/admin/teams',
      '/admin/campaigns',
      '/admin/clients',
      '/admin/transfer-work',
      '/admin/audit',
      // System ops.
      '/admin/jobs',
      '/admin/imports',
      '/admin/outbound',
      // Regression guard: this route hung indefinitely when Redis was
      // unreachable before the isQueueReachable() fix.
      '/admin/worker-health',
    ],
    denied: [],
  },
  {
    label: 'Floor Manager',
    email: 'sonny@telestar.vn',
    // proxy.ts ADMIN_ROLES admits floor managers, so the whole console must render
    // for them too — it previously had no /admin coverage at all.
    allowed: [
      ...DASHBOARD_ROUTES,
      '/team',
      '/email-health',
      '/leadgen-manager',
      '/opportunities',
      '/admin',
      '/admin/users',
      '/admin/teams',
      '/admin/campaigns',
      '/admin/clients',
      '/admin/transfer-work',
      '/admin/audit',
    ],
    denied: [],
  },
  {
    label: 'Team Lead',
    email: 'brandon@telestar.vn',
    allowed: [...DASHBOARD_ROUTES, '/team'],
    denied: ['/director', '/admin', '/admin/users'],
  },
  {
    label: 'SDR',
    email: 'lan.pham@telestar.vn',
    allowed: DASHBOARD_ROUTES,
    denied: ['/director', '/team', '/admin', '/admin/users'],
  },
  {
    label: 'Leadgen Manager',
    email: 'dominic@telestar.vn',
    allowed: ['/leadgen-manager', '/leadgen'],
    denied: ['/director', '/admin', '/admin/users'],
  },
  {
    label: 'Leadgen',
    email: 'alex@telestar.vn',
    allowed: ['/leadgen'],
    denied: ['/leadgen-manager', '/director', '/admin', '/admin/users'],
  },
];

/** Errors collected from the browser for the lifetime of one test. */
type ErrorSink = { consoleErrors: string[]; pageErrors: string[]; serverErrors: string[] };

function attachErrorListeners(page: Page): ErrorSink {
  const sink: ErrorSink = { consoleErrors: [], pageErrors: [], serverErrors: [] };

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const locUrl = msg.location()?.url || '';
    if (IGNORED_CONSOLE.some((re) => re.test(text) || re.test(locUrl))) return;
    sink.consoleErrors.push(`${page.url()} :: ${text}`);
  });

  page.on('pageerror', (err) => {
    sink.pageErrors.push(`${page.url()} :: ${err.message}`);
  });

  // Any 5xx from the app itself — including XHR the page fires after load,
  // which a status check on page.goto() alone would miss.
  page.on('response', (res) => {
    if (res.status() >= 500) {
      sink.serverErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  return sink;
}

function assertClean(sink: ErrorSink, context: string) {
  expect(sink.serverErrors, `${context}: server 5xx responses`).toEqual([]);
  expect(sink.pageErrors, `${context}: uncaught exceptions`).toEqual([]);
  expect(sink.consoleErrors, `${context}: console errors`).toEqual([]);
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  // A failed sign-in renders an inline error and stays on /login, which would
  // otherwise surface later as a confusing redirect assertion.
  const failure = page.locator('text=Invalid email or password.');
  await expect
    .poll(
      async () => {
        if (await failure.isVisible().catch(() => false)) return 'rejected';
        return page.url().includes('/login') ? 'pending' : 'signed-in';
      },
      { timeout: 20000, message: `sign-in for ${email}` }
    )
    .toBe('signed-in');
}

test.describe('Deep smoke — unauthenticated', () => {
  test('login page renders and gates the app', async ({ page }) => {
    const sink = attachErrorListeners(page);

    const res = await page.goto('/');
    expect(res?.status(), 'GET / status').toBeLessThan(500);
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    assertClean(sink, 'login page');
  });

  test('protected routes redirect to login when signed out', async ({ page }) => {
    for (const route of ['/leads', '/team', '/director', '/admin/jobs']) {
      await page.goto(route);
      await expect(page, `${route} should bounce to /login`).toHaveURL(/.*login/);
    }
  });
});

for (const persona of PERSONAS) {
  test.describe(`Deep smoke — ${persona.label}`, () => {
    test(`${persona.label} opens every permitted route without errors`, async ({ page }) => {
      const sink = attachErrorListeners(page);
      await login(page, persona.email);

      const brokenRoutes: string[] = [];

      for (const route of persona.allowed) {
        const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
        const status = res?.status() ?? 0;

        if (status >= 500) {
          brokenRoutes.push(`${route} -> HTTP ${status}`);
          continue;
        }

        // Bounced to login means the session dropped, not an access rule.
        if (page.url().includes('/login')) {
          brokenRoutes.push(`${route} -> session lost, redirected to /login`);
          continue;
        }

        // Next's error boundary renders instead of the page on a render throw.
        const crashed = await page
          .locator('text=/Application error|Unhandled Runtime Error|500 - Internal/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (crashed) brokenRoutes.push(`${route} -> rendered an error boundary`);

        // A role-gated page renders null and redirects home from an effect, which
        // produces no error of any kind. Without this the sweep passes vacuously
        // on a route the persona cannot actually use.
        const stayed = await expect
          .poll(() => new URL(page.url()).pathname === route, { timeout: 5000 })
          .toBe(true)
          .then(() => true)
          .catch(() => false);
        if (!stayed) {
          brokenRoutes.push(`${route} -> redirected to ${new URL(page.url()).pathname}`);
          continue;
        }

        // The comment used to say "every route should paint a heading" while the assertion
        // only checked that `<body>` was non-empty — which the sidebar alone satisfies, so a
        // route whose content died quietly still passed. Assert the heading it claims to.
        // Verified across all 18 routes: each paints exactly one `<h1>`, per
        // `.claude/rules/frontend-ux.md`.
        // Wait for it rather than sampling once: these pages fetch their data client-side, so
        // the heading lands a beat after `domcontentloaded`. A bare `isVisible()` here reported
        // five personas as broken purely because it looked too early.
        const heading = await page
          .locator('h1')
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (!heading) brokenRoutes.push(`${route} -> painted no heading`);
      }

      expect(brokenRoutes, `${persona.label}: routes that failed to render`).toEqual([]);
      assertClean(sink, persona.label);
    });

    if (persona.denied.length > 0) {
      test(`${persona.label} is gated from routes above its role`, async ({ page }) => {
        await login(page, persona.email);

        const leaks: string[] = [];
        for (const route of persona.denied) {
          await page.goto(route, { waitUntil: 'domcontentloaded' });

          // Some gates redirect from the client after hydration, so the URL
          // right after domcontentloaded is still the requested path. Give the
          // redirect a chance to land before calling it a leak.
          const bounced = await expect
            .poll(() => new URL(page.url()).pathname !== route, { timeout: 15000 })
            .toBe(true)
            .then(() => true)
            .catch(() => false);

          if (!bounced) leaks.push(route);
        }
        expect(leaks, `${persona.label}: routes reachable that should be denied`).toEqual([]);
      });
    }
  });
}

test.describe('Deep smoke — outbound email safety', () => {
  test('sequence engine refuses to send while autosend is disabled', async ({ page, request }) => {
    // Managers can reach this route from a browser session, not just cron —
    // so the disabled guard has to hold for an authenticated caller too.
    await login(page, 'dean@telestar.vn');

    const res = await request.get('/api/cron/sequence-engine', {
      headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
    });

    expect(res.status(), 'sequence-engine status').toBeLessThan(500);
    const body = await res.json();

    // SEQUENCE_AUTOSEND_ENABLED is the only guard on this path: it calls
    // EmailService.send() directly and never consults EMAIL_SEND_DRY_RUN.
    expect(
      body,
      'sequence-engine must report disabled — a body without disabled:true means live sending is armed'
    ).toMatchObject({ disabled: true, sent: 0 });
  });
});
