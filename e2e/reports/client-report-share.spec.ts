/**
 * §34 — client reports and, more importantly, the public share link.
 *
 * The share link is the only route in the CRM that answers without a session — `proxy.ts`
 * excludes `client-reports/public` and `api/client-reports/public` precisely so the recipient,
 * who is the customer rather than Telestar staff, can open it. That makes it the one place
 * where an authorization mistake is visible to someone outside the company, so the assertions
 * here are about what the token exposes as much as whether it works:
 *
 *   - an unknown or revoked token must not resolve
 *   - a valid token must return the report and **nothing else** — no lead rows, no user
 *     records, no internal ids from the rest of the CRM
 *   - a password-protected link must not give up its contents to an unauthenticated GET
 *
 * Role gates come from `lib/client-reports/access.ts`: create is director/FM/TL/SDR, share is
 * director/FM/TL (not SDR), approve is director/FM.
 */
import { test, expect } from '../support/test';
import { apiAs, apiAnonymous, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix } from '../support/ids';
import type { APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

async function createReport(api: APIRequestContext) {
  const s = stamp();
  const { status, body } = await readJson(
    await api.post('/api/client-reports', {
      data: {
        clientId: fixture().clientA,
        campaignId: fixture().campaignA,
        title: `PW_AUDIT_REPORT_${s}`,
        periodType: 'weekly',
        periodStart: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        periodEnd: new Date().toISOString(),
      },
    })
  );
  expect(status, `report create failed: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);
  // The route answers `{ report }`, not the report itself — BUG-003 records a spec that read
  // `.id` off the envelope and silently got undefined.
  const envelope = body as { report?: { id: string }; id?: string };
  const id = envelope.report?.id ?? envelope.id;
  expect(id, `could not find a report id in ${JSON.stringify(body).slice(0, 200)}`).toBeTruthy();
  return id!;
}

async function share(api: APIRequestContext, reportId: string, data: Record<string, unknown> = {}) {
  const { status, body } = await readJson(
    await api.post(`/api/client-reports/${reportId}/share`, { data })
  );
  expect(status, `share failed: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);
  return body as { token: string; shareUrl: string; shareLink: { id: string } };
}

test.describe('client report creation and role gates', () => {
  test('a director can create a report and read it back', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const reportId = await createReport(api);

    const { status } = await readJson(await api.get(`/api/client-reports/${reportId}`));
    expect(status).toBe(200);

    await api.delete(`/api/client-reports/${reportId}`);
    await api.dispose();
  });

  test('an SDR cannot create a share link', async ({ baseURL, recorder }) => {
    // canShareClientReport excludes SDRs even though they may create reports — an SDR
    // publishing a link to a customer is the thing this prevents.
    recorder.expectFailures(403);
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);

    const sdr = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await sdr.post(`/api/client-reports/${reportId}/share`, { data: {} })
    );
    expect(status, `an SDR created a share link (${status})`).toBe(403);
    await sdr.dispose();

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });

  test('an SDR cannot approve a report', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403);
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);

    const sdr = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(await sdr.post(`/api/client-reports/${reportId}/approve`));
    expect(status, `an SDR approved a report (${status})`).toBe(403);
    await sdr.dispose();

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });
});

test.describe('public share link', () => {
  test('a valid token opens without a session and exposes only the report', async ({
    baseURL,
  }) => {
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);
    const { token } = await share(admin, reportId);

    // No cookies at all — this is the customer's browser, not a staff one.
    const anon = await apiAnonymous(baseURL!);
    const { status, body } = await readJson(await anon.get(`/api/client-reports/public/${token}`));
    expect(status, 'a valid share token did not open').toBe(200);

    // The leak check, scoped to what a customer must *not* see.
    //
    // Prospect company names are deliberately not on that list: a client report exists to tell
    // the client which companies were met, so their presence is the feature working. An
    // earlier version of this test flagged them and was wrong. What must never appear is
    // Telestar's own data — staff addresses, credential material — or the internal cuids that
    // `toClientSafeSnapshot` strips precisely so a link holder gets no map of our object graph.
    const serialized = JSON.stringify(body);
    expect(serialized, 'the public report leaked a staff email').not.toContain('@audit.test');
    expect(serialized.toLowerCase(), 'the public report leaked password material').not.toContain(
      'passwordhash'
    );
    expect(serialized, 'the public report leaked internal row ids').not.toMatch(/"[a-z0-9]{25}"/);
    await anon.dispose();

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });

  test('an unknown token does not resolve', async ({ recorder, baseURL }) => {
    recorder.expectFailures(400, 401, 403, 404);
    const anon = await apiAnonymous(baseURL!);
    const { status, body } = await readJson(
      await anon.get('/api/client-reports/public/pw-audit-not-a-real-token')
    );
    expect(status, `an unknown token returned ${status}`).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body), 'the error leaked report data').not.toContain('PW_AUDIT_REPORT');
    await anon.dispose();
  });

  test('a revoked token stops working', async ({ baseURL, recorder }) => {
    recorder.expectFailures(400, 401, 403, 404);
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);
    const { token, shareLink } = await share(admin, reportId);
    const linkId = shareLink.id;

    const anon = await apiAnonymous(baseURL!);
    expect(
      (await readJson(await anon.get(`/api/client-reports/public/${token}`))).status,
      'the token did not work before revocation, so revoking proves nothing'
    ).toBe(200);

    // The route takes `linkId` from the **query string**, not the body
    // (`app/api/client-reports/[id]/share/route.ts:DELETE`), and answers 400 without it. Sending
    // it as JSON looks right and silently revokes nothing.
    const revoked = await readJson(
      await admin.delete(`/api/client-reports/${reportId}/share?linkId=${encodeURIComponent(linkId)}`)
    );
    expect(revoked.status, `revoke failed: ${JSON.stringify(revoked.body).slice(0, 200)}`).toBeLessThan(
      300
    );

    const after = await readJson(await anon.get(`/api/client-reports/public/${token}`));
    expect(after.status, `a revoked token still resolved (${after.status})`).toBeGreaterThanOrEqual(
      400
    );
    await anon.dispose();

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });

  test('an expired token does not resolve', async ({ baseURL, recorder }) => {
    recorder.expectFailures(400, 401, 403, 404);
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);
    // Expiry in the past — the check must be against the clock, not against creation order.
    const { token } = await share(admin, reportId, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const anon = await apiAnonymous(baseURL!);
    const { status } = await readJson(await anon.get(`/api/client-reports/public/${token}`));
    expect(status, `an expired token still resolved (${status})`).toBeGreaterThanOrEqual(400);
    await anon.dispose();

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });

  test('a password-protected link does not give up its contents without the password', async ({
    baseURL,
    recorder,
  }) => {
    recorder.expectFailures(400, 401, 403);
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);
    const { token } = await share(admin, reportId, { password: 'pw-audit-share-secret' });

    const anon = await apiAnonymous(baseURL!);

    // Without a password the endpoint answers `{ requiresPassword: true, title, clientName }`
    // by design — the recipient needs to know what they are being asked to unlock, and they
    // already hold the link. The contract is that the **snapshot** stays empty.
    const bare = await readJson(await anon.get(`/api/client-reports/public/${token}`));
    const bareBody = bare.body as { requiresPassword?: boolean; snapshot?: unknown };
    expect(bareBody.requiresPassword, 'the link did not ask for a password').toBe(true);
    expect(
      bareBody.snapshot ?? null,
      'a password-protected report returned its contents to an unauthenticated GET'
    ).toBeNull();

    const wrong = await readJson(
      await anon.post(`/api/client-reports/public/${token}`, { data: { password: 'wrong' } })
    );
    expect(
      (wrong.body as { snapshot?: unknown }).snapshot ?? null,
      'a wrong password returned the report'
    ).toBeNull();

    // Control: the right password must work, or the assertions above prove only that the
    // endpoint is broken.
    const right = await readJson(
      await anon.post(`/api/client-reports/public/${token}`, {
        data: { password: 'pw-audit-share-secret' },
      })
    );
    expect(right.status, `the correct password was rejected: ${JSON.stringify(right.body).slice(0, 200)}`).toBe(200);

    await anon.dispose();
    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });

  test('a share token from tenant A is not reachable as tenant B data', async ({
    baseURL,
    recorder,
  }) => {
    // A public token is tenant-agnostic by construction, so the thing to prove is that it
    // resolves to *its own* report and cannot be used as a lever into another tenant.
    recorder.expectFailures(400, 403, 404);
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);
    const { token } = await share(admin, reportId);

    const anon = await apiAnonymous(baseURL!);
    const { body } = await readJson(await anon.get(`/api/client-reports/public/${token}`));
    expect(JSON.stringify(body), 'a public report referenced tenant B').not.toContain(
      fixture().tenants.b
    );
    await anon.dispose();

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });
});

test.describe('report exports', () => {
  test('CSV export returns a file to a permitted role', async ({ baseURL }) => {
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);

    const res = await admin.get(`/api/client-reports/${reportId}/export/csv`);
    expect(res.status(), 'CSV export failed').toBe(200);
    const body = await res.text();
    expect(body.length, 'CSV export was empty').toBeGreaterThan(0);

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });

  test('exports are not reachable without a session', async ({ baseURL, recorder }) => {
    recorder.expectFailures(401, 403, 404);
    const admin = await apiAs('director', baseURL!);
    const reportId = await createReport(admin);

    const anon = await apiAnonymous(baseURL!);
    const { status } = await readJson(await anon.get(`/api/client-reports/${reportId}/export/csv`));
    expect(status, `an anonymous CSV export returned ${status}`).toBeGreaterThanOrEqual(400);
    await anon.dispose();

    await admin.delete(`/api/client-reports/${reportId}`);
    await admin.dispose();
  });
});
