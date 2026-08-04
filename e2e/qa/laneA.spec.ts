/**
 * Lane A — preflight / auth (Phase 1) + permission matrix (Phase 11).
 *
 * READ-ONLY lane. Every request is a GET or a navigation; nothing is created,
 * mutated or deleted. Two other lanes share this DB concurrently.
 *
 * Throwaway QA scaffolding — not part of the committed e2e suite.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { attachRecorders, gotoTimed, laneDir, login, logout, note, sessionRole, shot, type Recorder } from './_helpers';
import { PASSWORD, PERSONAS, PERSONA_ROLE, ROUTES, type PersonaKey } from './personas';

const LANE = 'A';

/** Writes a structured artefact this lane's report is built from. */
function record(name: string, payload: unknown): void {
  fs.writeFileSync(path.join(laneDir(LANE, 'data'), `${name}.json`), JSON.stringify(payload, null, 2));
}

/** Routes every role gets probed against, regardless of the DENIED map. */
const PROBE_ROUTES: { path: string; guard: 'edge' | 'client' | 'none'; markers: string[] }[] = [
  { path: ROUTES.director, guard: 'client', markers: ['Director Cockpit', 'Closing', 'Pipeline'] },
  { path: ROUTES.team, guard: 'client', markers: ['Team View', 'Leaderboard', 'Campaign', 'Meetings Booked'] },
  { path: ROUTES.adminJobs, guard: 'edge', markers: ['Job', 'Queue', 'enqueued'] },
  { path: ROUTES.adminOutbound, guard: 'edge', markers: ['Outbound', 'Message'] },
  { path: ROUTES.adminImports, guard: 'edge', markers: ['Import'] },
  { path: ROUTES.adminWorkerHealth, guard: 'edge', markers: ['Worker', 'Health'] },
  { path: ROUTES.leadgenManager, guard: 'client', markers: ['Internal Database', 'Qualification Queue', 'Campaign Routing'] },
  { path: ROUTES.opportunities, guard: 'none', markers: ['Opportunit', 'Pipeline Value', 'Forecast'] },
  { path: ROUTES.leadgen, guard: 'client', markers: ['Leadgen', 'Prospect', 'Pool'] },
];

/** GET-only API probes. A page that bounces but an API that answers is the real hole. */
const API_PROBES = [
  '/api/admin/jobs',
  '/api/admin/outbound',
  '/api/admin/imports',
  '/api/admin/worker-health',
  '/api/team/leaderboard',
  '/api/team/alerts',
  '/api/client-reports',
  '/api/opportunities?limit=5',
  '/api/leads?limit=5',
  '/api/users',
  '/api/leadgen-pool?limit=5',
  '/api/campaigns',
  '/api/health',
];

type LeakSample = { ms: number; pathname: string; textLen: number; markersHit: string[]; snippet: string };

/**
 * Navigates to a client-guarded route and samples the DOM every 40ms while the
 * guard's useEffect races the render. Returns everything that was on screen
 * *before* the bounce landed — that is the leak evidence.
 */
async function watchForLeak(
  page: Page,
  target: string,
  markers: string[],
  budgetMs = 6000
): Promise<{ samples: LeakSample[]; leaked: boolean; finalUrl: string; firstOffRouteMs: number | null }> {
  const samples: LeakSample[] = [];
  let firstOffRouteMs: number | null = null;

  const started = Date.now();
  await page.goto(target, { waitUntil: 'commit' }).catch(() => {});

  while (Date.now() - started < budgetMs) {
    const snap = await page
      .evaluate(() => ({
        pathname: window.location.pathname,
        text: document.body?.innerText ?? '',
      }))
      .catch(() => null);

    if (snap) {
      const ms = Date.now() - started;
      const hit = markers.filter((m) => snap.text.includes(m));
      samples.push({
        ms,
        pathname: snap.pathname,
        textLen: snap.text.length,
        markersHit: hit,
        snippet: snap.text.replace(/\s+/g, ' ').slice(0, 240),
      });
      if (snap.pathname !== target.split('?')[0] && firstOffRouteMs === null) {
        firstOffRouteMs = ms;
        // one more sample after the bounce, then stop
        break;
      }
    }
    await page.waitForTimeout(40);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const onRoute = samples.filter((s) => s.pathname === target.split('?')[0]);
  const leaked = onRoute.some((s) => s.markersHit.length > 0);

  return { samples, leaked, finalUrl: page.url(), firstOffRouteMs };
}

/** Reads the sidebar the role actually renders. */
async function readSidebar(page: Page): Promise<{ name: string; href: string }[]> {
  await page.waitForSelector('aside a[href]', { timeout: 15000 }).catch(() => {});
  return page.$$eval('aside a[href]', (nodes) =>
    nodes.map((n) => ({
      name: (n.textContent ?? '').trim().replace(/\s+/g, ' '),
      href: (n as HTMLAnchorElement).getAttribute('href') ?? '',
    }))
  );
}

/** Heuristic read of "did this page actually give the user something". */
async function describePage(page: Page): Promise<{
  h1: string;
  textLen: number;
  snippet: string;
  hasErrorText: boolean;
  emptyPhrases: string[];
  hasCta: boolean;
}> {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const errorRe = /(something went wrong|application error|unhandled|failed to load|Internal Server Error|client-side exception)/i;
    const emptyRe = /(no results|no leads|no tasks|no data|nothing here|empty|no opportunities|no reports|no meetings|no sequences|no templates|0 of 0)/gi;
    return {
      h1: (document.querySelector('h1')?.textContent ?? '').trim(),
      textLen: text.length,
      snippet: text.replace(/\s+/g, ' ').slice(0, 400),
      hasErrorText: errorRe.test(text),
      emptyPhrases: Array.from(new Set((text.match(emptyRe) ?? []).map((s) => s.toLowerCase()))),
      hasCta: document.querySelectorAll('button, a[href]').length > 6,
    };
  });
}

// ---------------------------------------------------------------------------
// Phase 1 — preflight / auth
// ---------------------------------------------------------------------------

test.describe('Phase 1 — preflight / auth', () => {
  test('1.1 anonymous visit to / redirects to /login and renders cleanly', async ({ page }) => {
    const rec = attachRecorders(page, LANE);
    await page.context().clearCookies();

    const nav = await gotoTimed(page, '/', rec);

    expect(nav.finalUrl, 'anonymous / must land on /login').toContain('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    const branding = await page.evaluate(() => ({
      h1: (document.querySelector('h1')?.textContent ?? '').trim(),
      hasFlame: !!document.querySelector('svg.lucide-flame') || (document.body.innerHTML ?? '').includes('lucide-flame'),
      subtitle: document.body.innerText.includes('SDR Operations Platform'),
      noRegister: document.body.innerText.includes('No self-registration'),
      title: document.title,
    }));

    const shotPath = await shot(page, LANE, '1-1-anon-login');
    record('phase1-1-anonymous', { nav, branding, pageErrors: rec.pageErrors, consoleErrors: rec.consoleErrors, shotPath });

    expect(branding.h1, 'login page branding').toBe('Telestar CRM');
    expect(rec.pageErrors, 'no uncaught page error on the login screen').toHaveLength(0);
    rec.flush('1-1-anonymous-redirect');
  });

  test('1.2 invalid credentials produce a safe, non-enumerating error', async ({ page }) => {
    const rec = attachRecorders(page, LANE);
    await page.context().clearCookies();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const attempt = async (email: string, password: string, label: string) => {
      const before = rec.failedRequests.length;
      let reloads = 0;

      // Clicking Sign In before hydration performs a native GET submit to
      // "/login?" which silently discards the attempt (see finding CRM-A-005 /
      // test 1.5). Retry once so this test measures the error *content*, not
      // the hydration race.
      for (let i = 0; i < 3; i++) {
        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');
        const shown = await page
          .waitForFunction(() => document.body.innerText.includes('Invalid email or password.'), null, { timeout: 12000 })
          .then(() => true)
          .catch(() => false);
        if (shown) break;
        reloads++;
      }
      const state = await page.evaluate(() => ({
        url: window.location.href,
        text: document.body.innerText.replace(/\s+/g, ' '),
      }));
      const shotPath = await shot(page, LANE, `1-2-${label}`);
      return {
        label,
        email,
        url: state.url,
        /** >0 means the click was swallowed by the pre-hydration native submit. */
        swallowedAttempts: reloads,
        bodyText: state.text.slice(0, 1200),
        newFailedRequests: rec.failedRequests.slice(before),
        shotPath,
      };
    };

    const wrongPassword = await attempt(PERSONAS.director, 'definitely-not-the-password', 'wrong-password');
    const unknownEmail = await attempt('nobody.here@telestar.vn', PASSWORD, 'unknown-email');

    const leakRe = /(PrismaClient|prisma\.|at Object\.|node_modules|\.ts:\d+|Invariant|stack|ECONNREFUSED|bcrypt|CredentialsSignin|SELECT )/i;

    record('phase1-2-invalid-login', {
      wrongPassword,
      unknownEmail,
      identicalMessage:
        wrongPassword.bodyText.includes('Invalid email or password.') &&
        unknownEmail.bodyText.includes('Invalid email or password.'),
      leakDetected: {
        wrongPassword: leakRe.test(wrongPassword.bodyText),
        unknownEmail: leakRe.test(unknownEmail.bodyText),
      },
      consoleErrors: rec.consoleErrors,
      pageErrors: rec.pageErrors,
    });

    // Both must fail closed on /login with the same generic message.
    expect(wrongPassword.url, 'wrong password must not authenticate').toContain('/login');
    expect(unknownEmail.url, 'unknown email must not authenticate').toContain('/login');
    expect(wrongPassword.bodyText).toContain('Invalid email or password.');
    expect(unknownEmail.bodyText).toContain('Invalid email or password.');
    expect(leakRe.test(wrongPassword.bodyText), 'no stack/Prisma leak in the UI').toBe(false);
    expect(leakRe.test(unknownEmail.bodyText), 'no stack/Prisma leak in the UI').toBe(false);

    rec.flush('1-2-invalid-login');
  });

  test('1.3 Demo Accounts panel exposes the shared password in plain text', async ({ page }) => {
    const rec = attachRecorders(page, LANE);
    await page.context().clearCookies();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const panel = await page.evaluate(() => {
      // NB: the panel header is CSS `uppercase`, and innerText applies
      // text-transform — match case-insensitively.
      const text = document.body.innerText;
      return {
        visible: /demo accounts/i.test(text),
        headerText: (Array.from(document.querySelectorAll('button')).find((b) => /demo accounts/i.test(b.textContent ?? ''))?.textContent ?? '').trim(),
        expandedByDefault: text.includes('Password for all accounts'),
        passwordOnScreen: text.includes('telestar2026'),
        accountEmails: Array.from(document.querySelectorAll('button'))
          .map((b) => (b.textContent ?? '').trim().replace(/\s+/g, ' '))
          .filter((t) => t.includes('@telestar.vn')),
      };
    });

    const shotPath = await shot(page, LANE, '1-3-demo-accounts-panel');
    record('phase1-3-demo-panel', { ...panel, shotPath, nodeEnvNote: 'gated on process.env.NODE_ENV !== "production"' });

    // Documenting reality, not asserting it away.
    expect(panel.visible, 'demo panel is present in this dev build').toBe(true);
    note(LANE, `1.3 demo panel: password on screen=${panel.passwordOnScreen}, one-click accounts=${panel.accountEmails.length}`);
    rec.flush('1-3-demo-accounts');
  });

  test('1.4 anonymous share link + /api/health reachability', async ({ page }) => {
    const rec = attachRecorders(page, LANE);
    await page.context().clearCookies();

    const token = 'qa-lane-a-probe-token';

    const pageNav = await gotoTimed(page, `/client-reports/public/${token}`, rec);
    const pageBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
    const shotPublic = await shot(page, LANE, '1-4-anon-share-link');

    const apiShare = await page.request.get(`/api/client-reports/public/${token}`);
    const apiShareBody = (await apiShare.text()).slice(0, 400);

    const health = await page.request.get('/api/health');
    const healthBody = (await health.text()).slice(0, 300);

    // A second, header-only probe to prove the 401 is the edge matcher, not the handler.
    const healthHead = await page.request.get('/api/health', { headers: { accept: 'application/json' } });

    record('phase1-4-anonymous-endpoints', {
      sharePage: { nav: pageNav, body: pageBody, shot: shotPublic },
      shareApi: { status: apiShare.status(), body: apiShareBody },
      health: { status: health.status(), body: healthBody, repeatStatus: healthHead.status() },
      failedRequests: rec.failedRequests,
    });

    note(
      LANE,
      `1.4 anon share page → ${pageNav.finalUrl} | share API ${apiShare.status()} | /api/health ${health.status()}`
    );
    rec.flush('1-4-anonymous-endpoints');
  });
});

// ---------------------------------------------------------------------------
// Phase 11 — permission matrix
// ---------------------------------------------------------------------------

const ROLE_CHECKS: PersonaKey[] = [
  'director',
  'floorManager',
  'teamLead',
  'sdrSpare',
  'leadgenManager',
  'leadgen',
];

for (const key of ROLE_CHECKS) {
  const email = PERSONAS[key];
  const expectedRole = PERSONA_ROLE[key];

  test(`11.x ${expectedRole} (${key}) — sidebar walk, denied-route probes, API probes`, async ({ page }) => {
    test.setTimeout(600_000);
    const rec: Recorder = attachRecorders(page, LANE);

    await login(page, email);
    const role = await sessionRole(page);

    // --- landing ---------------------------------------------------------
    const landing = await gotoTimed(page, '/', rec);
    await page.waitForTimeout(1200); // let the client-side role redirect settle
    const landedAt = page.url();
    await shot(page, LANE, `11-${expectedRole}-landing`);

    // --- sidebar walk ----------------------------------------------------
    const sidebar = await readSidebar(page);
    const sidebarResults: Record<string, unknown>[] = [];

    for (const item of sidebar) {
      if (!item.href || item.href.startsWith('http')) continue;
      const before = { errs: rec.pageErrors.length, failed: rec.failedRequests.length };
      const nav = await gotoTimed(page, item.href, rec);
      await page.waitForTimeout(900);
      const desc = await describePage(page);
      const newFailed = rec.failedRequests.slice(before.failed);
      const newErrs = rec.pageErrors.slice(before.errs);

      const verdict =
        nav.finalUrl.includes('/login')
          ? 'BOUNCED_TO_LOGIN'
          : !nav.finalUrl.includes(item.href.split('?')[0]) && item.href !== '/'
            ? 'REDIRECTED'
            : desc.hasErrorText || newErrs.length > 0
              ? 'ERROR'
              : desc.textLen < 400
                ? 'BLANK'
                : newFailed.some((f) => f.status === 403 || f.status >= 500)
                  ? 'PARTIAL_DATA_FAILURE'
                  : 'OK';

      if (verdict !== 'OK') {
        await shot(page, LANE, `11-${expectedRole}-sidebar-${item.href.replace(/[^a-z0-9]+/gi, '-')}`);
      }

      sidebarResults.push({ item, nav, verdict, ...desc, newFailed, newErrs });
    }

    // --- denied route probes --------------------------------------------
    const deniedResults: Record<string, unknown>[] = [];
    for (const probe of PROBE_ROUTES) {
      const before = rec.failedRequests.length;
      const watch = await watchForLeak(page, probe.path, probe.markers);
      await page.waitForTimeout(700);
      const finalUrl = page.url();
      const desc = await describePage(page);

      const stayed = finalUrl.includes(probe.path);
      const outcome = stayed ? 'ALLOWED' : 'REDIRECTED';
      const leaked = !stayed && watch.leaked;

      if (leaked || (stayed && probe.guard !== 'none')) {
        await shot(page, LANE, `11-${expectedRole}-probe-${probe.path.replace(/[^a-z0-9]+/gi, '-')}`);
      }

      deniedResults.push({
        path: probe.path,
        declaredGuard: probe.guard,
        outcome,
        leaked,
        firstOffRouteMs: watch.firstOffRouteMs,
        finalUrl,
        onRouteSamples: watch.samples.filter((s) => s.pathname === probe.path).slice(0, 8),
        allSampleCount: watch.samples.length,
        landedDescription: { h1: desc.h1, textLen: desc.textLen, snippet: desc.snippet.slice(0, 160) },
        newFailed: rec.failedRequests.slice(before),
      });
    }

    // --- API probes ------------------------------------------------------
    const apiResults: Record<string, unknown>[] = [];
    for (const url of API_PROBES) {
      // Short, explicit timeout: an endpoint that cannot answer in 15s under a
      // read-only GET is itself the finding, and a 30s default would make the
      // lane unrunnable.
      const t0 = Date.now();
      const res = await page.request.get(url, { timeout: 15000 }).catch((e: unknown) => {
        apiResults.push({
          url,
          status: 'NO_RESPONSE',
          ms: Date.now() - t0,
          error: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200),
        });
        return null;
      });
      if (!res) continue;
      const raw = await res.text().catch(() => '');
      let rows: number | null = null;
      try {
        const j = JSON.parse(raw);
        rows = Array.isArray(j)
          ? j.length
          : Array.isArray(j?.data)
            ? j.data.length
            : Array.isArray(j?.opportunities)
              ? j.opportunities.length
              : Array.isArray(j?.reports)
                ? j.reports.length
                : Array.isArray(j?.leads)
                  ? j.leads.length
                  : Array.isArray(j?.leaderboard)
                    ? j.leaderboard.length
                    : null;
      } catch {
        /* non-JSON body */
      }
      apiResults.push({
        url,
        status: res.status(),
        ms: Date.now() - t0,
        rows,
        bodyPreview: raw.replace(/\s+/g, ' ').slice(0, 220),
      });
    }

    record(`phase11-${expectedRole}`, {
      persona: key,
      email,
      expectedRole,
      sessionRole: role,
      landing: { nav: landing, landedAt },
      sidebar,
      sidebarResults,
      deniedResults,
      apiResults,
      consoleErrors: rec.consoleErrors.slice(0, 40),
      pageErrors: rec.pageErrors.slice(0, 40),
    });

    note(
      LANE,
      `11.x ${expectedRole}: session=${role} landing=${landedAt} sidebar=${sidebar.length} ` +
        `leaks=${deniedResults.filter((d) => d.leaked).length} allowed=${deniedResults.filter((d) => d.outcome === 'ALLOWED').map((d) => d.path).join(',')}`
    );

    await logout(page);
    rec.flush(`11-${expectedRole}`);

    expect(role, `${email} must authenticate as ${expectedRole}`).toBe(expectedRole);
  });
}

// ---------------------------------------------------------------------------
// 11.6 — targeted verification of the two claims that carry security weight:
//   (a) did the leadgen_manager -> /leadgen "leak" flag reflect real content or
//       just sidebar chrome matching a loose marker?
//   (b) what does a leadgen_manager actually see on /team, which is reachable by
//       URL but absent from their sidebar?
// ---------------------------------------------------------------------------
test('11.6 leadgen_manager — leak-flag forensics on /leadgen and /team content', async ({ page }) => {
  test.setTimeout(240_000);
  const rec = attachRecorders(page, LANE);
  await login(page, PERSONAS.leadgenManager);

  // (a) full sample trace, no slicing, on the bounce off /leadgen
  const samples: LeakSample[] = [];
  const started = Date.now();
  await page.goto('/leadgen', { waitUntil: 'commit' }).catch(() => {});
  while (Date.now() - started < 8000) {
    const snap = await page
      .evaluate(() => ({ pathname: window.location.pathname, text: document.body?.innerText ?? '' }))
      .catch(() => null);
    if (snap) {
      samples.push({
        ms: Date.now() - started,
        pathname: snap.pathname,
        textLen: snap.text.length,
        // Content that only the leadgen SDR workspace renders — not nav chrome.
        markersHit: ['Leadgen Pipeline', 'Prospect', 'Assigned to me', 'Qualified'].filter((m) => snap.text.includes(m)),
        snippet: snap.text.replace(/\s+/g, ' ').slice(0, 500),
      });
      if (snap.pathname !== '/leadgen') break;
    }
    await page.waitForTimeout(40);
  }
  const onLeadgen = samples.filter((s) => s.pathname === '/leadgen');

  // (b) what /team really renders for this role
  await page.goto('/team', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const teamShot = await shot(page, LANE, '11-6-leadgen-manager-team-view');
  const teamView = await page.evaluate(() => ({
    url: window.location.href,
    h1: (document.querySelector('h1')?.textContent ?? '').trim(),
    textLen: document.body.innerText.length,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500),
    sidebarHrefs: Array.from(document.querySelectorAll('aside a[href]')).map((a) => a.getAttribute('href')),
  }));

  const leaderboard = await page.request.get('/api/team/leaderboard?dateRange=month');
  const leaderboardBody = (await leaderboard.text()).slice(0, 900);

  record('phase11-6-leadgen-manager-forensics', {
    leadgenBounce: {
      totalSamples: samples.length,
      onRouteSamples: onLeadgen,
      realContentLeak: onLeadgen.some((s) => s.markersHit.length > 0),
    },
    teamView: { ...teamView, shot: teamShot },
    leaderboardApi: { status: leaderboard.status(), body: leaderboardBody },
  });

  note(
    LANE,
    `11.6 leadgen_manager: /leadgen realContentLeak=${onLeadgen.some((s) => s.markersHit.length > 0)} | ` +
      `/team h1="${teamView.h1}" len=${teamView.textLen} teamInSidebar=${teamView.sidebarHrefs.includes('/team')} | ` +
      `leaderboard ${leaderboard.status()}`
  );

  await logout(page);
  rec.flush('11-6-leadgen-manager-forensics');
});

// ---------------------------------------------------------------------------
// 1.5 — how long does a failed login take to tell the user anything, and does
// the submit button ever come back? Test 1.2 saw one attempt produce no banner
// at all inside 3.5s, so this measures the real feedback latency instead of
// guessing at a fixed wait.
// ---------------------------------------------------------------------------
test('1.5 failed-login feedback latency and stuck-button check', async ({ page }) => {
  test.setTimeout(180_000);
  const rec = attachRecorders(page, LANE);
  await page.context().clearCookies();

  const attempts: Record<string, unknown>[] = [];

  for (const [label, email, password] of [
    ['wrong-password-cold', PERSONAS.director, 'definitely-not-the-password'],
    ['unknown-email', 'nobody.here@telestar.vn', PASSWORD],
    ['wrong-password-warm', PERSONAS.teamLead, 'nope-nope-nope'],
  ] as const) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);

    const t0 = Date.now();
    await page.click('button[type="submit"]');

    let bannerMs: number | null = null;
    let spinnerSeen = false;
    const timeline: { ms: number; banner: boolean; spinner: boolean; url: string }[] = [];

    while (Date.now() - t0 < 20000) {
      const s = await page
        .evaluate(() => ({
          banner: document.body.innerText.includes('Invalid email or password.'),
          spinner: document.body.innerText.includes('Signing in...'),
          url: window.location.href,
        }))
        .catch(() => null);
      if (s) {
        timeline.push({ ms: Date.now() - t0, ...s });
        if (s.spinner) spinnerSeen = true;
        if (s.banner && bannerMs === null) bannerMs = Date.now() - t0;
        if (s.banner) break;
      }
      await page.waitForTimeout(100);
    }

    const end = await page.evaluate(() => ({
      banner: document.body.innerText.includes('Invalid email or password.'),
      stuckSpinner: document.body.innerText.includes('Signing in...'),
      submitDisabled: (document.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.disabled ?? null,
      url: window.location.href,
    }));

    if (!end.banner || end.stuckSpinner) await shot(page, LANE, `1-5-${label}`);

    attempts.push({
      label,
      email,
      bannerMs,
      spinnerSeen,
      ...end,
      timelineSamples: timeline.filter((_, i) => i % 5 === 0).slice(0, 40),
    });
  }

  record('phase1-5-login-feedback', { attempts, consoleErrors: rec.consoleErrors, pageErrors: rec.pageErrors });
  note(LANE, `1.5 login feedback: ${attempts.map((a: any) => `${a.label}=${a.bannerMs ?? 'NO_BANNER'}ms stuck=${a.stuckSpinner}`).join(' | ')}`);
  rec.flush('1-5-login-feedback');

  for (const a of attempts as any[]) {
    expect(a.banner, `${a.label}: user must eventually see an error`).toBe(true);
    expect(a.stuckSpinner, `${a.label}: submit button must not stay in "Signing in..."`).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// 11.7 — /api/campaigns is requireAuth() only (app/api/campaigns/route.ts:13)
// with `include: { client: true }` and a tenant-wide cache key. Confirm what a
// low-privilege role can actually enumerate.
// ---------------------------------------------------------------------------
test('11.7 client roster exposure via /api/campaigns for low-privilege roles', async ({ page }) => {
  test.setTimeout(240_000);
  const rec = attachRecorders(page, LANE);
  const findings: Record<string, unknown>[] = [];

  for (const persona of ['sdrSpare', 'leadgen'] as const) {
    await login(page, PERSONAS[persona]);
    const role = await sessionRole(page);

    const res = await page.request.get('/api/campaigns', { timeout: 15000 });
    const body = await res.json().catch(() => null);
    const rows: any[] = Array.isArray(body) ? body : [];

    // Which campaigns is this user actually assigned to? Leads they can see is
    // the closest read-only proxy available to this lane.
    const leadsRes = await page.request.get('/api/leads?limit=200', { timeout: 15000 });
    const leadsBody = await leadsRes.json().catch(() => null);
    const leadArr: any[] = Array.isArray(leadsBody) ? leadsBody : (leadsBody?.leads ?? leadsBody?.data ?? []);
    const reachableCampaignIds = new Set(leadArr.map((l: any) => l.campaignId).filter(Boolean));

    const clientsRes = await page.request.get('/api/campaigns?type=clients', { timeout: 15000 });
    const clientsBody = await clientsRes.json().catch(() => null);

    findings.push({
      persona,
      role,
      campaignsStatus: res.status(),
      campaignCount: rows.length,
      distinctClients: [...new Set(rows.map((c: any) => c.client?.name).filter(Boolean))],
      // The sensitive part: Client.contactName / Client.contactEmail are the
      // customer's own buyer contact, returned in full by the include.
      clientContactFieldsExposed: rows
        .map((c: any) => c.client)
        .filter(Boolean)
        .slice(0, 8)
        .map((cl: any) => ({
          name: cl.name,
          industry: cl.industry,
          contactName: cl.contactName,
          contactEmail: cl.contactEmail,
          status: cl.status,
        })),
      campaignsUserCanActuallyReach: [...reachableCampaignIds].length,
      leadsVisible: leadArr.length,
      clientsEndpoint: { status: clientsRes.status(), count: Array.isArray(clientsBody?.clients) ? clientsBody.clients.length : null },
    });

    await logout(page);
  }

  record('phase11-7-campaign-client-exposure', findings);
  note(
    LANE,
    `11.7 ${findings.map((f: any) => `${f.role}: ${f.campaignCount} campaigns / ${f.distinctClients.length} clients visible, reachable=${f.campaignsUserCanActuallyReach}, contactEmail exposed=${!!f.clientContactFieldsExposed[0]?.contactEmail}`).join(' | ')}`
  );
  rec.flush('11-7-campaign-client-exposure');
});
