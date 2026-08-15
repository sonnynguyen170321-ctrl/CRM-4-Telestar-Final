/**
 * §8/§9 — authorization decided by the session, never by the request body.
 *
 * `tenant-isolation.spec.ts` proves a caller cannot reach a foreign row *by id*. This covers
 * the other direction: a caller who is authorized for the endpoint, and who supplies a field
 * naming somebody else's tenant, owner or campaign. That is mass assignment, and it is a
 * different bug from a missing access check — the check passes, and the write lands somewhere
 * it should not.
 *
 * `tests/tenant-inject.test.ts` covers the injection helper in isolation. Nothing covered the
 * HTTP boundary, which is where a client actually gets to choose these values.
 *
 * Fixture shape (scripts/e2e-audit-fixture.ts):
 *   tenant A — director, floorManager, teamLead, sdrA, sdrB, leadgenManager, leadgen
 *   tenant B — directorB, sdrTenantB, campaign B
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix } from '../support/ids';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

/** A minimal valid lead payload; each test overrides the field it is trying to abuse. */
const leadPayload = (s: string, extra: Record<string, unknown>) => ({
  firstName: 'PW',
  lastName: `Spoof${s}`,
  company: `PW_AUDIT_CO_SPOOF_${s}`,
  email: `pw.spoof.${s}@audit.test`,
  campaignId: fixture().campaignA,
  ...extra,
});

test.describe('the request body cannot choose a tenant', () => {
  test('a tenantId in the body does not move the row into another tenant', async ({ baseURL }) => {
    const s = stamp();
    const api = await apiAs('sdrA', baseURL!);

    const created = await readJson(
      await api.post('/api/leads', {
        data: leadPayload(s, { tenantId: fixture().tenants.b }),
      })
    );
    expect(created.status, `create failed: ${JSON.stringify(created.body)}`).toBeLessThan(300);
    const leadId = (created.body as { id: string }).id;

    // The lead must belong to the caller's tenant regardless of what they asked for. Read it
    // back from tenant B — the tenant the body named — and it must not be there.
    const foreign = await apiAs('directorB', baseURL!);
    const seen = await readJson(await foreign.get(`/api/leads/${leadId}`));
    expect(
      [403, 404],
      `tenant B could read a lead a tenant A user tagged with tenant B's id (${seen.status})`
    ).toContain(seen.status);
    await foreign.dispose();

    // And it is readable by its real owner.
    const own = await readJson(await api.get(`/api/leads/${leadId}`));
    expect(own.status).toBe(200);

    await api.delete(`/api/leads/${leadId}`).catch(() => {});
    await api.dispose();
  });
});

test.describe('the request body cannot choose an owner', () => {
  test('an SDR cannot assign a new lead to an SDR they do not manage', async ({
    baseURL,
    recorder,
  }) => {
    recorder.expectFailures(403);
    const s = stamp();
    const api = await apiAs('sdrA', baseURL!);

    // `app/api/leads/route.ts` gates this with `canAccessUser`. Peers are not accessible to
    // each other, so this must be refused rather than silently reassigned to the caller.
    const res = await readJson(
      await api.post('/api/leads', {
        data: leadPayload(s, { assignedToId: fixture().users.sdrB.id }),
      })
    );
    expect(res.status, `SDR A assigned a lead to SDR B and got ${res.status}`).toBe(403);
    await api.dispose();
  });

  test('an SDR cannot assign a new lead to a user in another tenant', async ({
    baseURL,
    recorder,
  }) => {
    recorder.expectFailures(403);
    const s = stamp();
    const api = await apiAs('sdrA', baseURL!);

    const res = await readJson(
      await api.post('/api/leads', {
        data: leadPayload(s, { assignedToId: fixture().users.sdrTenantB.id }),
      })
    );
    expect(res.status, `cross-tenant owner spoof returned ${res.status}`).toBe(403);
    await api.dispose();
  });

  test('a team lead can assign to an SDR in their own pod', async ({ baseURL }) => {
    // The negative cases above are only meaningful if the positive one works — otherwise they
    // would pass against an endpoint that refuses everybody.
    const s = stamp();
    const api = await apiAs('teamLead', baseURL!);

    const res = await readJson(
      await api.post('/api/leads', {
        data: leadPayload(s, { assignedToId: fixture().users.sdrA.id }),
      })
    );
    expect(res.status, `team lead could not assign to their own SDR: ${JSON.stringify(res.body)}`).toBeLessThan(300);

    await api.delete(`/api/leads/${(res.body as { id: string }).id}`).catch(() => {});
    await api.dispose();
  });
});

test.describe('the request body cannot choose a campaign', () => {
  test('a lead cannot be created into another tenant campaign', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403, 404);
    const s = stamp();
    const api = await apiAs('sdrA', baseURL!);

    // `lead -> campaign -> client` is the chain every report and client-facing export walks.
    // A lead stamped with tenant A but pointing at a tenant B campaign is a cross-tenant edge
    // in that graph, created entirely from the request body. Reproduced at HTTP 201 before the
    // check in `canReferenceCampaign` existed.
    const res = await readJson(
      await api.post('/api/leads', {
        data: leadPayload(s, { campaignId: fixture().campaignB }),
      })
    );

    // 404, not 403: a foreign-tenant campaign must be indistinguishable from one that does not
    // exist, or the error itself confirms foreign rows to anyone willing to guess ids.
    expect(
      res.status,
      `a tenant A SDR attached a lead to tenant B's campaign: ${JSON.stringify(res.body).slice(0, 200)}`
    ).toBe(404);

    const created = (res.body as { id?: string })?.id;
    expect(created, 'no lead may be created by a refused request').toBeUndefined();
    await api.dispose();
  });

  test('a refused campaign reference leaves no Account or Contact behind', async ({
    baseURL,
    recorder,
  }) => {
    recorder.expectFailures(403, 404);
    const s = stamp();
    const api = await apiAs('sdrA', baseURL!);

    // The route creates or finds an Account and a Contact *before* it creates the Lead. Refusing
    // only at `lead.create` would still return an error while leaving two durable rows behind —
    // so a rejected request would quietly pollute the tenant with every attempt. The check has to
    // run before any of that, and this is what proves it did.
    const company = `PW_AUDIT_CO_SPOOF_${s}`;
    const email = `pw.spoof.${s}@audit.test`;

    const res = await readJson(
      await api.post('/api/leads', {
        data: leadPayload(s, { campaignId: fixture().campaignB, company, email }),
      })
    );
    expect(res.status).toBe(404);

    // Searching the caller's own tenant: if the side effects landed, they landed here.
    const leads = await readJson(await api.get(`/api/leads?search=${encodeURIComponent(company)}`));
    expect(leads.status).toBe(200);
    const rows = (leads.body as { leads?: unknown[] })?.leads ?? (leads.body as unknown[]);
    expect(
      Array.isArray(rows) ? rows.length : 0,
      'a refused request created a lead in the caller tenant'
    ).toBe(0);

    // The Account and Contact rows are not reachable over HTTP — there is no `/api/accounts` —
    // so the durable half of this claim is asserted in `tests/lead-reference-integrity.test.ts`,
    // which counts the rows directly. Checking them here through an endpoint that does not exist
    // would produce an assertion that silently never runs, which is worse than no assertion.
    await api.dispose();
  });
});
