/**
 * §6 "Session invalidation" — a live session must stop working the moment the account behind
 * it changes, not when its JWT happens to expire.
 *
 * Sessions here are stateless JWTs, so the only revocation mechanism is `User.authVersion`:
 * `getSessionUser` (`lib/auth.ts:51`) re-reads the row on every protected request and refuses
 * any token whose stamped version no longer matches. These tests exercise that from the
 * outside — two independent request contexts, one acting as the admin and one holding the
 * session being revoked — which is the only way to tell revocation from "the token expired".
 *
 * Every case uses a disposable account, never a fixture role: deactivating `sdrA` would break
 * the storage state the rest of the audit depends on.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture, fixturePassword } from '../support/fixture';
import { request, type APIRequestContext } from '@playwright/test';

/**
 * A fresh address per test, per §53's `PW_<run>_<case>` convention.
 *
 * A single shared address does not work: `POST /api/users` answers **409 Email already in use**
 * for an account that is still active, so any test that did not end by deactivating its victim
 * poisoned every later test in the file. Unique-per-test also means the four cases stay
 * independent of each other's ordering.
 */
function victimEmail(caseName: string): string {
  return `pw.revoke.${caseName}.${Date.now()}@audit.test`;
}

/** Create the disposable user and return its id. */
async function createVictim(admin: APIRequestContext, email: string): Promise<string> {
  const res = await admin.post('/api/users', {
    data: {
      email,
      password: fixturePassword(),
      firstName: 'PW',
      lastName: 'Revoke',
      role: 'sdr',
      managerId: fixture().users.teamLead.id,
    },
  });
  const { status, body } = await readJson(res);
  expect(status, `create victim failed: ${JSON.stringify(body)}`).toBeLessThan(300);
  return (body as { id: string }).id;
}

/** A request context holding a live session for the disposable user. */
async function signInAs(baseURL: string, email: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const { csrfToken } = (await (await ctx.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await ctx.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: fixturePassword(), callbackUrl: `${baseURL}/`, json: 'true' },
  });
  expect(res.status(), 'victim sign-in failed').toBeLessThan(400);
  const session = (await (await ctx.get('/api/auth/session')).json()) as { user?: { email?: string } } | null;
  expect(session?.user?.email, 'victim session did not establish').toBe(email);
  return ctx;
}

/** Prove the session works right now, so a later 401 means revocation and not a bad setup. */
async function expectSessionLive(ctx: APIRequestContext) {
  const res = await ctx.get('/api/tasks');
  expect(res.status(), 'session should be usable before revocation').toBe(200);
}

/**
 * Revocation is asserted against a **protected application endpoint**, not against
 * `/api/auth/session`.
 *
 * That distinction cost a round of failures worth recording. `/api/auth/session` is NextAuth's
 * own route: it decodes the JWT and reports the claims inside it, and never calls
 * `getSessionUser`. So after a revocation it still answers with the old user — while
 * `/api/tasks`, which does go through `getSessionUser`, correctly returns 401. The
 * authorization boundary is the second one, and asserting on the first would have failed a
 * working security control.
 *
 * The gap is not nothing, though — see the P3 note in docs/playwright-audit/FINDINGS.md: the
 * client keeps believing it is signed in while every data call 401s. That is a degraded UI
 * state, not an access-control failure.
 */
async function expectSessionRejected(ctx: APIRequestContext) {
  const res = await ctx.get('/api/tasks');
  expect(res.status(), 'the stale token must be refused on its next request').toBe(401);
}

test.describe('session revocation', () => {
  test('deactivating a user rejects their already-open session on the next request', async ({
    baseURL,
  }) => {
    const CASE = 'deactivate';
    const admin = await apiAs('director', baseURL!);
    const email = victimEmail(CASE);
    const victimId = await createVictim(admin, email);
    const victim = await signInAs(baseURL!, email);
    await expectSessionLive(victim);

    const res = await admin.put(`/api/users/${victimId}`, { data: { isActive: false } });
    const { status, body } = await readJson(res);
    expect(status, `deactivate failed: ${JSON.stringify(body)}`).toBe(200);

    await expectSessionRejected(victim);

    await admin.put(`/api/users/${victimId}`, { data: { isActive: false } });
    await admin.dispose();
    await victim.dispose();
  });

  test('sign out all sessions rejects an already-open session', async ({ baseURL }) => {
    const CASE = 'signoutall';
    const admin = await apiAs('director', baseURL!);
    const email = victimEmail(CASE);
    const victimId = await createVictim(admin, email);
    const victim = await signInAs(baseURL!, email);
    await expectSessionLive(victim);

    const res = await admin.post(`/api/admin/users/${victimId}/sign-out-all`);
    const { status, body } = await readJson(res);
    expect(status, `sign-out-all failed: ${JSON.stringify(body)}`).toBeLessThan(300);

    await expectSessionRejected(victim);

    // Distinct from deactivation: the account still works, the old token does not.
    const fresh = await signInAs(baseURL!, email);
    await expectSessionLive(fresh);

    await admin.put(`/api/users/${victimId}`, { data: { isActive: false } });
    await admin.dispose();
    await victim.dispose();
    await fresh.dispose();
  });

  test('a role change rejects the old token rather than honouring its stale role', async ({
    baseURL,
  }) => {
    const CASE = 'rolechange';
    const admin = await apiAs('director', baseURL!);
    const email = victimEmail(CASE);
    const victimId = await createVictim(admin, email);
    const victim = await signInAs(baseURL!, email);
    await expectSessionLive(victim);

    // Promote them. The token still claims `sdr`; authorization must not consult it at all.
    const res = await admin.put(`/api/users/${victimId}`, {
      data: { role: 'team_lead', managerId: fixture().users.floorManager.id },
    });
    const { status, body } = await readJson(res);
    expect(status, `role change failed: ${JSON.stringify(body)}`).toBe(200);

    await expectSessionRejected(victim);

    await admin.put(`/api/users/${victimId}`, { data: { isActive: false } });
    await admin.dispose();
    await victim.dispose();
  });

  test('an admin password reset rejects the old session', async ({ baseURL }) => {
    const CASE = 'passwordreset';
    // The point of a reset is that whoever knew the old password is locked out — false if
    // their session survives it.
    const admin = await apiAs('director', baseURL!);
    const email = victimEmail(CASE);
    const victimId = await createVictim(admin, email);
    const victim = await signInAs(baseURL!, email);
    await expectSessionLive(victim);

    const res = await admin.put(`/api/users/${victimId}`, {
      data: { newPassword: `${fixturePassword()}-rotated` },
    });
    const { status, body } = await readJson(res);
    expect(status, `password reset failed: ${JSON.stringify(body)}`).toBe(200);

    await expectSessionRejected(victim);

    await admin.put(`/api/users/${victimId}`, { data: { isActive: false } });
    await admin.dispose();
    await victim.dispose();
  });
});

/**
 * PW-AUDIT-001 — the automation cap route authorizes from the token instead of the database.
 *
 * `app/api/automation/accounts/[id]/cap/route.ts:11-16` reads `auth()` — the raw JWT — rather
 * than `getSessionUser()`. Every other guarded route re-reads the user row and refuses a token
 * whose `authVersion` no longer matches, which is the whole point of the revocation mechanism
 * the tests above verify. This one skips it, so a deactivated account holding an unexpired
 * token keeps a live deliverability control.
 *
 * Written to fail before the fix, per §51.
 */
test.describe('PW-AUDIT-001 — token-trusting route', () => {
  test('a deactivated manager cannot still change an email account send cap', async ({
    baseURL,
    recorder,
  }) => {
    recorder.expectFailures(401, 403);
    const CASE = 'captoken';
    const admin = await apiAs('director', baseURL!);
    const email = victimEmail(CASE);

    // The route gates on director/floor_manager/team_lead, so the victim needs one of those.
    const created = await admin.post('/api/users', {
      data: {
        email,
        password: fixturePassword(),
        firstName: 'PW',
        lastName: 'CapToken',
        role: 'team_lead',
        managerId: fixture().users.floorManager.id,
      },
    });
    const createdBody = await readJson(created);
    expect(createdBody.status, `create failed: ${JSON.stringify(createdBody.body)}`).toBeLessThan(300);
    const victimId = (createdBody.body as { id: string }).id;

    const victim = await signInAs(baseURL!, email);
    await expectSessionLive(victim);

    // Deactivate: `authVersion` is bumped, so every other route now refuses this token.
    const deact = await readJson(await admin.put(`/api/users/${victimId}`, { data: { isActive: false } }));
    expect(deact.status, `deactivate failed: ${JSON.stringify(deact.body)}`).toBe(200);
    await expectSessionRejected(victim);

    // …but this route consults the cookie, not the row.
    const res = await victim.patch(`/api/automation/accounts/${fixture().mailboxA}/cap`, {
      data: { dailyCap: 7777 },
    });
    const { status } = await readJson(res);
    expect(
      [401, 403],
      `a deactivated user changed a send cap (${status}) — the route trusted the token`
    ).toContain(status);

    await admin.dispose();
    await victim.dispose();
  });
});
