/**
 * §9 — multi-tenant isolation, and §8 — cross-user access between two SDRs.
 *
 * Worth stating what is actually under test here. `DB_RLS_ENFORCED` is unset everywhere
 * (`docs/pre-domain-hardening/STATUS.md` Task 6), so Postgres row-level security is **off** and
 * the only thing standing between tenant A and tenant B is the app-layer `tenantId` injection
 * in `lib/prisma.ts` / `lib/tenant-inject.ts`. These tests exercise that layer directly, with
 * real ids captured from the fixture rather than guessed — a hidden sidebar proves nothing, so
 * every case names a specific foreign row and tries to touch it.
 *
 * Fixture shape (scripts/e2e-audit-fixture.ts):
 *   tenant A — director, floorManager, teamLead, sdrA, sdrB, leadgenManager, leadgen
 *              sdrA owns lead `leads.sdrA`; sdrB owns lead `leads.sdrB`; both in campaign A
 *   tenant B — directorB, sdrTenantB, owning lead `leads.tenantB` in campaign B
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';

test.describe('cross-tenant isolation', () => {
  test('a tenant A director cannot read a tenant B lead by direct id', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('director', baseURL!);
    const { status, body } = await readJson(await api.get(`/api/leads/${fixture().leads.tenantB}`));
    expect(
      [403, 404],
      `tenant A director got ${status} for a tenant B lead: ${JSON.stringify(body).slice(0, 200)}`
    ).toContain(status);
    await api.dispose();
  });

  test('a tenant A director cannot mutate a tenant B lead', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('director', baseURL!);
    const { status } = await readJson(
      await api.put(`/api/leads/${fixture().leads.tenantB}`, { data: { company: 'PW_AUDIT_TENANT_BREACH' } })
    );
    expect([403, 404], `cross-tenant update returned ${status}`).toContain(status);

    // And prove it by reading the row back from the tenant that owns it.
    const owner = await apiAs('directorB', baseURL!);
    const after = await readJson(await owner.get(`/api/leads/${fixture().leads.tenantB}`));
    expect(after.status).toBe(200);
    expect((after.body as { company?: string }).company).not.toBe('PW_AUDIT_TENANT_BREACH');
    await owner.dispose();
    await api.dispose();
  });

  test('a tenant A lead list never contains tenant B rows', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const { status, body } = await readJson(await api.get('/api/leads?limit=200'));
    expect(status).toBe(200);
    const rows = (Array.isArray(body) ? body : (body as { leads?: unknown[] }).leads ?? []) as {
      id?: string;
    }[];
    expect(rows.some((r) => r.id === fixture().leads.tenantB), 'tenant B lead leaked into tenant A list').toBe(false);
    await api.dispose();
  });

  test('a tenant A director cannot see tenant B users', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const { status, body } = await readJson(await api.get('/api/users'));
    expect(status).toBe(200);
    const rows = (Array.isArray(body) ? body : (body as { users?: unknown[] }).users ?? []) as {
      email?: string;
    }[];
    // Match tenant B's identities exactly. A substring test does not work here: an earlier
    // version filtered on `.b@`, which matches `pw.sdr.b@audit.test` — that is sdr**B**, a
    // tenant **A** user — and reported a cross-tenant leak that was purely the test's own
    // sloppiness. Naming the foreign accounts removes the ambiguity.
    const tenantBEmails = new Set([fixture().users.directorB.email, fixture().users.sdrTenantB.email]);
    const leaked = rows.filter((u) => u.email && tenantBEmails.has(u.email));
    expect(leaked, `tenant B users visible from tenant A: ${JSON.stringify(leaked)}`).toEqual([]);
    await api.dispose();
  });

  test('a tenant A director cannot read a tenant B campaign', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('director', baseURL!);
    const { status } = await readJson(await api.get(`/api/campaigns/${fixture().campaignB}`));
    expect([403, 404, 405], `cross-tenant campaign read returned ${status}`).toContain(status);
    await api.dispose();
  });
});

test.describe('cross-user access between two SDRs in the same campaign', () => {
  // sdrA and sdrB report to the same team lead and share campaign A. `canAccessLead`
  // (lib/auth.ts:294) gives SDRs the user axis only, so neither may touch the other's lead
  // despite the shared campaign — that is the property under test.
  const foreign = () => fixture().leads.sdrB;

  test('SDR A cannot read SDR B lead', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(await api.get(`/api/leads/${foreign()}`));
    expect([403, 404], `SDR A got ${status} reading a teammate's lead`).toContain(status);
    await api.dispose();
  });

  test('SDR A cannot edit SDR B lead', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await api.put(`/api/leads/${foreign()}`, { data: { company: 'PW_AUDIT_IDOR' } })
    );
    expect([403, 404], `SDR A edited a teammate's lead (${status})`).toContain(status);

    const owner = await apiAs('sdrB', baseURL!);
    const after = await readJson(await owner.get(`/api/leads/${foreign()}`));
    expect((after.body as { company?: string }).company).not.toBe('PW_AUDIT_IDOR');
    await owner.dispose();
    await api.dispose();
  });

  test('SDR A cannot add a note to SDR B lead', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await api.post('/api/notes', { data: { leadId: foreign(), content: 'PW_AUDIT_IDOR note' } })
    );
    expect([403, 404], `SDR A wrote a note onto a teammate's lead (${status})`).toContain(status);
    await api.dispose();
  });

  test('SDR A cannot create a task on SDR B lead', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await api.post('/api/tasks', {
        // `type` must be a member of `taskType` (lib/validation/schemas.ts:8). An earlier
        // version sent `type: 'call'`, which is not, so `parseBody` returned 400 before the
        // authorization check ever ran — the request proved nothing about access control.
        // Accepting 400 here would have been a green test over an untested code path.
        data: {
          leadId: foreign(),
          type: 'phone',
          title: 'PW_AUDIT_IDOR task',
          dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
    );
    expect([403, 404], `SDR A created a task on a teammate's lead (${status})`).toContain(status);
    await api.dispose();
  });

  test('SDR A cannot create a reminder on SDR B lead', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await api.post('/api/reminders', {
        data: {
          leadId: foreign(),
          text: 'PW_AUDIT_IDOR reminder',
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
    );
    expect([403, 404], `SDR A created a reminder on a teammate's lead (${status})`).toContain(status);
    await api.dispose();
  });

  test('SDR A can still work their own lead', async ({ baseURL }) => {
    // The control. Without it, an endpoint that 403s everybody would pass every test above.
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(await api.get(`/api/leads/${fixture().leads.sdrA}`));
    expect(status, 'SDR A must be able to read their own lead').toBe(200);
    await api.dispose();
  });

  test('the team lead above both SDRs can reach either lead', async ({ baseURL }) => {
    // Account axis: `canAccessLead` grants TL/FM access via campaign membership, so a
    // blanket denial would be wrong in the other direction.
    const api = await apiAs('teamLead', baseURL!);
    for (const id of [fixture().leads.sdrA, fixture().leads.sdrB]) {
      const { status } = await readJson(await api.get(`/api/leads/${id}`));
      expect(status, `team lead was refused lead ${id}`).toBe(200);
    }
    await api.dispose();
  });
});

test.describe('PW-AUDIT-002 — automation cap route, cross-tenant write', () => {
  test('a tenant A manager cannot change the send cap of a tenant B email account', async ({
    baseURL,
    recorder,
  }) => {
    // Settles the open question in docs/playwright-audit/FINDINGS.md by experiment rather than
    // by reading more code. `app/api/automation/accounts/[id]/cap/route.ts:28-42` looks the
    // account up with `findUnique` and then performs the update inside
    // `tenantStorage.run({ tenantId: account.tenantId })` — the **account's** tenant, not the
    // caller's. If `applyScopedTenant` does not constrain that lookup, a tenant A manager can
    // raise the daily send cap on a tenant B mailbox, which is a P0 cross-tenant write.
    recorder.expectFailures(400, 401, 403, 404);
    const targetId = fixture().mailboxB;

    const attacker = await apiAs('floorManager', baseURL!);
    const { status } = await readJson(
      await attacker.patch(`/api/automation/accounts/${targetId}/cap`, { data: { dailyCap: 9999 } })
    );
    expect([401, 403, 404], `cross-tenant cap write returned ${status}`).toContain(status);
    await attacker.dispose();

    // Status alone is not proof — read the row back through the tenant that owns it.
    // `/api/email/accounts` lists only the *caller's* mailboxes, so the read-back has to be
    // the owning SDR rather than tenant B's director.
    const owner = await apiAs('sdrTenantB', baseURL!);
    const accounts = await readJson(await owner.get('/api/email/accounts'));
    const row = (Array.isArray(accounts.body) ? accounts.body : []).find(
      (a: { id?: string }) => a.id === targetId
    ) as { dailyCap?: number } | undefined;
    expect(row, 'tenant B mailbox missing — re-run scripts/e2e-audit-fixture.ts').toBeTruthy();
    expect(row?.dailyCap, 'the cap was changed across a tenant boundary').not.toBe(9999);
    await owner.dispose();
  });
});
