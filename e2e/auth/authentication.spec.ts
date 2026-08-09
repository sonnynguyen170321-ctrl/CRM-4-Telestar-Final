/**
 * §6 — Authentication, exercised through the real login form.
 *
 * The setup project signs in over the API for determinism; this file is where the UI path is
 * actually held to account, including whether it is reliable.
 */
import { test, expect } from '../support/test';
import { fixture, fixturePassword, type RoleKey } from '../support/fixture';

/** Roles that live in tenant A and should reach the app. */
const TENANT_A_ROLES: RoleKey[] = [
  'director',
  'floorManager',
  'teamLead',
  'sdrA',
  'leadgenManager',
  'leadgen',
];

/**
 * The signed-in user, or null.
 *
 * `/api/auth/session` answers a bare `null` body when there is no session — not `{}` — so
 * reading `.user` off the parsed body throws rather than reporting "signed out". Worth a
 * helper because every auth assertion in this file goes through it.
 */
async function sessionUser(
  page: import('@playwright/test').Page
): Promise<{ email?: string; role?: string } | null> {
  const res = await page.request.get('/api/auth/session');
  if (!res.ok()) return null;
  const body = (await res.json()) as { user?: { email?: string; role?: string } } | null;
  return body?.user ?? null;
}

/**
 * Sign in through the form.
 *
 * The `blur()` is load-bearing, and the reason is worth writing down because it looks like
 * superstition. The login form is controlled React state, and `handleSubmit` closes over the
 * `email`/`password` of the render it was created in (`app/login/page.tsx:51-54`). Filling and
 * clicking back to back — microseconds apart, which no human does — can run a handler from the
 * render *before* the state committed, submitting empty credentials and earning a real 401 and
 * a real "Invalid email or password.". Blurring forces the pending input events to be processed
 * first.
 *
 * That race was measured, not assumed: the same credentials driven straight at
 * `/api/auth/callback/credentials` succeeded 30/30, while the form path failed for a different
 * role on each run. It is an automation artifact rather than a user-facing defect — but it is
 * exactly the kind of thing that gets mislabelled "flaky test" and left to rot.
 */
async function formLogin(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await expect(emailInput).toHaveValue(email);
  await expect(passwordInput).toHaveValue(password);
  await passwordInput.blur();
  await page.click('button[type="submit"]');
}

// Storage state must not leak into these tests — they are about signing in from nothing.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('valid login', () => {
  for (const role of TENANT_A_ROLES) {
    test(`${role} signs in through the form and the session resolves to their role`, async ({
      page,
    }) => {
      const user = fixture().users[role];
      await formLogin(page, user.email, fixturePassword());

      await page.waitForURL((url) => !url.pathname.includes('/login'), { waitUntil: 'commit' });

      const signedIn = await sessionUser(page);
      expect(signedIn?.email).toBe(user.email);
      // The DB role, which is what `getSessionUser` authorizes on.
      expect(signedIn?.role).toBe(user.role);

      // Session survives a full reload — not just React state.
      await page.reload({ waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).pathname).not.toContain('/login');
      expect((await sessionUser(page))?.email).toBe(user.email);
    });
  }
});

test.describe('invalid login', () => {
  // NextAuth answers a rejected credential with 401; that is the expected outcome here,
  // not a defect, so it is declared rather than silently tolerated.
  test.beforeEach(async ({ recorder }) => {
    recorder.expectFailures(401);
  });

  const cases: { name: string; email: () => string; password: string }[] = [
    { name: 'wrong password', email: () => fixture().users.director.email, password: 'definitely-not-the-password' },
    { name: 'nonexistent user', email: () => 'nobody.at.all@audit.test', password: 'definitely-not-the-password' },
  ];

  for (const c of cases) {
    test(`${c.name} is refused with the generic message`, async ({ page }) => {
      await formLogin(page, c.email(), c.password);
      // The form must stay put and say nothing specific about why.
      await expect(page.getByText('Invalid email or password.')).toBeVisible();
      expect(new URL(page.url()).pathname).toContain('/login');

      expect(await sessionUser(page)).toBeNull();
    });
  }

  test('a malformed address never reaches the server', async ({ page }) => {
    // `input[type="email"]` + `required` means the browser blocks submission, so no
    // credential ever leaves the machine and no in-page error is rendered. Asserting the
    // generic message here would be asserting the wrong contract.
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', 'not-an-email');
    await page.fill('input[type="password"]', 'definitely-not-the-password');
    await page.click('button[type="submit"]');
    await expect(page.locator('input[type="email"]')).toHaveJSProperty('validity.valid', false);
    expect(new URL(page.url()).pathname).toContain('/login');
    expect(await sessionUser(page)).toBeNull();
  });

  test('blank password is refused by the browser before any request is made', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', fixture().users.director.email);
    await page.click('button[type="submit"]');
    // `required` on the input means no network call happens at all.
    expect(new URL(page.url()).pathname).toContain('/login');
    expect(await sessionUser(page)).toBeNull();
  });

  test('an unknown address and a real address with a wrong password are indistinguishable', async ({
    page,
  }) => {
    // Account enumeration check: the two must be byte-identical to the user.
    await formLogin(page, fixture().users.director.email, 'definitely-not-the-password');
    const realUserMessage = await page.getByText('Invalid email or password.').textContent();

    await formLogin(page, 'nobody.at.all@audit.test', 'definitely-not-the-password');
    const unknownUserMessage = await page.getByText('Invalid email or password.').textContent();

    expect(unknownUserMessage).toBe(realUserMessage);
  });
});

test.describe('logout', () => {
  /**
   * Signs out the way a user does: the Topbar menu's "Sign Out" item, which calls
   * `signOut({ callbackUrl: '/login' })` (components/Topbar.tsx:555).
   *
   * An earlier version of this posted to `/api/auth/signout` through `page.request`. That
   * endpoint is correct — driven directly it answers 302 with
   * `authjs.session-token=; Max-Age=0` and the session goes null — but routing it through the
   * API context rather than the page did not reliably clear the page's own cookie, so the
   * test was measuring Playwright's cookie jar instead of the product. Clicking the control
   * tests the thing users actually touch.
   */
  async function signOutViaUi(page: import('@playwright/test').Page) {
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await page.waitForURL((url) => url.pathname.includes('/login'), { waitUntil: 'commit' });
  }

  /**
   * next-auth's client refetches `/api/auth/session` right after sign-in. Signing out while
   * one of those is still in flight can re-establish the cookie *after* sign-out cleared it —
   * see PW-AUDIT-005. Two seconds is comfortably past it; measured, a settled sign-out was
   * clean 3/3 while an immediate one failed 1/3 on a production build.
   */
  async function settleAfterLogin(page: import('@playwright/test').Page) {
    await page.waitForTimeout(2000);
  }

  /** Opens the Topbar user menu that holds the sign-out item (components/Topbar.tsx:484-487). */
  async function openUserMenu(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /^User menu —/ }).click();
    await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible();
  }

  test('signing out drops the session and protected routes redirect', async ({ page }) => {
    const user = fixture().users.sdrA;
    await formLogin(page, user.email, fixturePassword());
    await page.waitForURL((url) => !url.pathname.includes('/login'), { waitUntil: 'commit' });
    // Let the post-login session refetch land before signing out. Without this the test
    // inherits PW-AUDIT-005 — a real race, covered by its own test below — and would fail
    // roughly one run in three for a reason that has nothing to do with what it asserts.
    await settleAfterLogin(page);

    await openUserMenu(page);
    await signOutViaUi(page);

    // Assert the access boundary, not `/api/auth/session`. That route decodes whatever token
    // is presented and reports its claims — it is not what authorizes anything, and an early
    // version of this test failed a working sign-out by asking it. See PW-AUDIT-004.
    await expect.poll(async () => (await page.request.get('/api/leads')).status()).toBe(401);

    await page.goto('/leads', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toContain('/login');
  });

  test('the back button does not restore protected content after signing out', async ({ page }) => {
    const user = fixture().users.sdrA;
    await formLogin(page, user.email, fixturePassword());
    await page.waitForURL((url) => !url.pathname.includes('/login'), { waitUntil: 'commit' });
    await settleAfterLogin(page);
    await page.goto('/leads', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/leads');
    // Every navigation mounts a fresh SessionProvider and refetches `/api/auth/session`, so
    // the PW-AUDIT-005 window reopens here — it is not specific to just-after-login.
    await settleAfterLogin(page);

    await openUserMenu(page);
    await signOutViaUi(page);
    // Give sign-out the same settle the first logout test gets before asserting. Polling
    // `/api/leads` from the instant the URL commits overlaps the PW-AUDIT-005 window, and
    // this test is about the back button, not about that race — which has its own test.
    await settleAfterLogin(page);
    expect(
      (await page.request.get('/api/leads')).status(),
      'sign-out must revoke API access'
    ).toBe(401);

    // What §6 actually requires is that going back must not restore protected **content**.
    // It does not. Measured: after Back the page paints the CRM chrome and a "Loading…"
    // placeholder, `/api/leads` answers 401, and no lead data appears — the previous user's
    // rows are gone.
    //
    // The URL does stay `/leads` rather than redirecting to `/login`, and that shell loads
    // forever. Real, but cosmetic, so it is recorded as PW-AUDIT-006 rather than failed here:
    // asserting a redirect the app never promised would fail a control that is doing its job.
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForTimeout(3000);

    expect(
      (await page.request.get('/api/leads')).status(),
      'going back must not restore API access'
    ).toBe(401);

    const restored = await page.locator('body').innerText();
    expect(restored, "the previous session's lead data must not be repainted").not.toContain(
      'PW_AUDIT_CO'
    );
  });
});

test.describe('unauthenticated direct access', () => {
  test.beforeEach(async ({ recorder }) => {
    recorder.expectFailures(401);
  });

  const PROTECTED_PAGES = ['/', '/leads', '/team', '/admin', '/admin/users', '/opportunities', '/inbox'];

  for (const route of PROTECTED_PAGES) {
    test(`${route} redirects to /login when signed out`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).pathname, `${route} should not render signed out`).toContain('/login');
    });
  }

  const PROTECTED_APIS = ['/api/leads', '/api/tasks', '/api/admin/users', '/api/opportunities'];

  for (const route of PROTECTED_APIS) {
    test(`${route} answers 401 when signed out`, async ({ page }) => {
      const res = await page.request.get(route);
      expect(res.status(), `${route} must reject an anonymous request`).toBe(401);
    });
  }
});

/**
 * PW-AUDIT-005 — signing out immediately after signing in can leave the session alive.
 *
 * Marked `fixme` because it documents a defect that is **not fixed**, not because it is
 * unreliable: on a production build this sequence left `authjs.session-token` in place and
 * `GET /api/leads` answering 200 in one run out of three. Under `next dev` — where React
 * StrictMode and dev-mode session polling widen the same window — it failed 3/3.
 *
 * Delete the `fixme` the day the client stops racing itself; the assertions below are the
 * contract and need no change.
 */
test.describe('known defect', () => {
  test.fixme(
    'PW-AUDIT-005: sign-out immediately after sign-in must still end the session',
    async ({ page }) => {
      const user = fixture().users.sdrA;
      await formLogin(page, user.email, fixturePassword());
      await page.waitForURL((url) => !url.pathname.includes('/login'), { waitUntil: 'commit' });

      // Deliberately no settle — that is the whole point.
      await page.getByRole('button', { name: /^User menu —/ }).click();
      await page.getByRole('menuitem', { name: /sign out/i }).click();
      await page.waitForURL((url) => url.pathname.includes('/login'), { waitUntil: 'commit' });

      await expect
        .poll(async () => (await page.request.get('/api/leads')).status())
        .toBe(401);
    }
  );
});
