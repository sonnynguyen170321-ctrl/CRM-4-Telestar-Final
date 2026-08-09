/**
 * Produces one signed-in storage state per role, consumed by every audit project.
 *
 * Runs as a Playwright `setup` project so the sign-in cost is paid once per run rather than
 * in every `beforeEach`, and — more importantly — so no two roles can ever share a browser
 * context by accident.
 *
 * **No browser is involved.** Two separate races made the page-driven version unreliable, and
 * both are worth recording because each looked like "flaky tests":
 *
 *  1. Driving the login *form* submitted stale credentials. The form is controlled React state
 *     and `handleSubmit` closes over the values of its render (`app/login/page.tsx:51-54`), so
 *     a `fill` + `click` microseconds apart can post empty fields and earn a genuine 401.
 *  2. Merely *visiting* `/login` before signing in over the API was enough to break it:
 *     next-auth's client fetches its own CSRF token on mount and rotates the
 *     `authjs.csrf-token` cookie, so the token captured a moment earlier no longer matched and
 *     the callback failed with `MissingCSRF` — a different random subset of roles on each run.
 *
 * A bare `APIRequestContext` touches neither. The login **form** is still tested for real in
 * `e2e/auth/authentication.spec.ts` (§6), which is where a UI-level sign-in defect belongs;
 * this file only needs a valid session.
 *
 * Each state is verified against `/api/auth/session` before being written. A storage state
 * that merely *exists* proves nothing; one whose session resolves to the expected role is
 * the thing the rest of the suite is allowed to depend on.
 */
import { test as setup, expect, request } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fixture, fixturePassword, storageStatePath, type RoleKey } from './fixture';

const ROLES: RoleKey[] = [
  'director',
  'floorManager',
  'teamLead',
  'sdrA',
  'sdrB',
  'leadgenManager',
  'leadgen',
  'directorB',
  'sdrTenantB',
];

for (const role of ROLES) {
  setup(`authenticate ${role}`, async ({ baseURL }) => {
    const user = fixture().users[role];
    const statePath = storageStatePath(role);
    mkdirSync(path.dirname(statePath), { recursive: true });

    const ctx = await request.newContext({ baseURL });

    const csrfRes = await ctx.get('/api/auth/csrf');
    expect(csrfRes.ok(), `csrf fetch failed for ${role}`).toBe(true);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const signIn = await ctx.post('/api/auth/callback/credentials', {
      form: {
        csrfToken,
        email: user.email,
        password: fixturePassword(),
        callbackUrl: `${baseURL}/`,
        json: 'true',
      },
    });
    expect(signIn.status(), `sign-in rejected for ${role}`).toBeLessThan(400);

    const session = await ctx.get('/api/auth/session');
    expect(session.ok(), `session request failed for ${role}`).toBe(true);
    // A signed-out session answers a bare `null` body, not `{}`.
    const body = (await session.json()) as { user?: { role?: string; email?: string } } | null;
    expect(body?.user?.email, `no session established for ${role}`).toBe(user.email);
    expect(body?.user?.role, `wrong role for ${role}`).toBe(user.role);

    await ctx.storageState({ path: statePath });
    await ctx.dispose();
  });
}
