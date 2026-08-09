/**
 * §40 — filters, search and limits, with the property that actually matters:
 * **no combination of query parameters may widen role or tenant scope.**
 *
 * `app/api/leads/route.ts` composes the role scope with AND specifically so a filter cannot
 * override it, and the comment there cites BUG-001 as the reason. That is the kind of
 * invariant that survives review and dies to a refactor, so it is tested by pointing filters
 * *at data the caller must not see* and checking the result stays empty — rather than by
 * checking that a filter returns something, which any broken query can also do.
 *
 * Every assertion computes its expectation from data this test created, per §10's rule that a
 * number must be checked against the records behind it and not merely asserted to exist.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix } from '../support/ids';
import type { APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

type Lead = { id: string; stage?: string; company?: string; assignedToId?: string };

async function listLeads(api: APIRequestContext, query: string) {
  const { status, body } = await readJson(await api.get(`/api/leads?${query}`));
  expect(status, `GET /api/leads?${query} failed`).toBe(200);
  return (Array.isArray(body) ? body : (body as { leads?: unknown[] }).leads ?? []) as Lead[];
}

async function createLead(api: APIRequestContext, overrides: Record<string, unknown> = {}) {
  const s = stamp();
  const { status, body } = await readJson(
    await api.post('/api/leads', {
      data: {
        firstName: 'PW',
        lastName: `Filter${s}`,
        company: `PW_AUDIT_CO_FILTER_${s}`,
        email: `pw.filter.${s}@audit.test`,
        campaignId: fixture().campaignA,
        assignedToId: fixture().users.sdrA.id,
        ...overrides,
      },
    })
  );
  expect(status, `create failed: ${JSON.stringify(body).slice(0, 200)}`).toBeLessThan(300);
  return body as Lead;
}

test.describe('filters compose with role scope, never replace it', () => {
  test('an SDR filtering by a teammate does not see the teammate leads', async ({ baseURL }) => {
    // The BUG-001 shape: `assignedTo` is caller-supplied, and if it replaced the role scope
    // instead of narrowing it, an SDR could read the whole team by guessing user ids.
    const api = await apiAs('sdrA', baseURL!);
    const rows = await listLeads(api, `assignedTo=${fixture().users.sdrB.id}&limit=200`);
    expect(
      rows.map((r) => r.id),
      "filtering by a teammate's id returned their leads to an SDR"
    ).not.toContain(fixture().leads.sdrB);
    await api.dispose();
  });

  test('an SDR filtering by another campaign sees nothing of it', async ({ baseURL }) => {
    const api = await apiAs('sdrA', baseURL!);
    const rows = await listLeads(api, `campaignId=${fixture().campaignB}&limit=200`);
    expect(rows.map((r) => r.id), 'a campaign filter reached another tenant campaign').not.toContain(
      fixture().leads.tenantB
    );
    await api.dispose();
  });

  test('a tenant A director filtering by a tenant B campaign gets nothing', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const rows = await listLeads(api, `campaignId=${fixture().campaignB}&limit=200`);
    expect(
      rows.map((r) => r.id),
      'a campaign filter crossed the tenant boundary for a director'
    ).not.toContain(fixture().leads.tenantB);
    await api.dispose();
  });

  test('searching for a foreign lead by its exact company name finds nothing', async ({
    baseURL,
  }) => {
    // Search is the widest caller-controlled input on this route, so it is the most likely
    // place for scope to be lost.
    const api = await apiAs('sdrA', baseURL!);
    const owner = await apiAs('sdrB', baseURL!);
    const foreign = (await readJson(await owner.get(`/api/leads/${fixture().leads.sdrB}`))).body as Lead;
    await owner.dispose();
    expect(foreign.company, 'could not read the foreign company name to search for').toBeTruthy();

    const rows = await listLeads(api, `search=${encodeURIComponent(foreign.company!)}&limit=200`);
    expect(rows.map((r) => r.id), 'search returned a lead outside the caller scope').not.toContain(
      fixture().leads.sdrB
    );
    await api.dispose();
  });
});

test.describe('filter correctness', () => {
  test('a stage filter returns only that stage, and the lead is really in it', async ({
    baseURL,
  }) => {
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);
    await api.put(`/api/leads/${lead.id}`, { data: { stage: 'meeting_booked' } });

    const rows = await listLeads(api, 'stage=meeting_booked&limit=200');
    expect(rows.map((r) => r.id), 'the filtered stage did not include the lead').toContain(lead.id);
    expect(
      rows.every((r) => r.stage === 'meeting_booked'),
      `stage filter returned other stages: ${JSON.stringify([...new Set(rows.map((r) => r.stage))])}`
    ).toBe(true);

    // And the negative: it must be absent from a different stage.
    const others = await listLeads(api, 'stage=new&limit=200');
    expect(others.map((r) => r.id), 'the lead appears under a stage it is not in').not.toContain(
      lead.id
    );

    await api.delete(`/api/leads/${lead.id}`);
    await api.dispose();
  });

  test('combining two filters narrows rather than widens', async ({ baseURL }) => {
    // §40 asks for combinations, not single filters — an implementation that ORs its clauses
    // passes every single-filter test and fails this one.
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);
    await api.put(`/api/leads/${lead.id}`, { data: { stage: 'replied', priority: 'hot' } });

    const both = await listLeads(api, 'stage=replied&priority=hot&limit=200');
    expect(both.map((r) => r.id)).toContain(lead.id);

    const contradictory = await listLeads(api, 'stage=replied&campaignId=' + fixture().campaignB);
    expect(
      contradictory.map((r) => r.id),
      'a contradictory filter pair returned rows, so the clauses are ORed'
    ).not.toContain(lead.id);

    await api.delete(`/api/leads/${lead.id}`);
    await api.dispose();
  });

  test('an invalid enum filter is rejected rather than ignored', async ({ baseURL, recorder }) => {
    // Silently dropping an unrecognised filter is worse than refusing it: the caller believes
    // they are looking at a filtered list and are not.
    recorder.expectFailures(400);
    const api = await apiAs('director', baseURL!);
    const { status } = await readJson(await api.get('/api/leads?stage=not_a_real_stage'));
    expect(status, 'an invalid stage filter was accepted').toBe(400);
    const p = await readJson(await api.get('/api/leads?priority=not_a_real_priority'));
    expect(p.status, 'an invalid priority filter was accepted').toBe(400);
    await api.dispose();
  });

  test('an archived lead leaves the default list and comes back with archived=true', async ({
    baseURL,
  }) => {
    const api = await apiAs('director', baseURL!);
    const lead = await createLead(api);

    expect((await listLeads(api, 'limit=500')).map((r) => r.id)).toContain(lead.id);
    await api.delete(`/api/leads/${lead.id}`);
    expect(
      (await listLeads(api, 'limit=500')).map((r) => r.id),
      'an archived lead is still in the default list'
    ).not.toContain(lead.id);
    expect(
      (await listLeads(api, 'archived=true&limit=500')).map((r) => r.id),
      'archived=true did not surface the archived lead'
    ).toContain(lead.id);

    await api.dispose();
  });

  test('an SDR cannot see archived leads even by asking', async ({ baseURL }) => {
    // `includeArchived` is deliberately ANDed with `user.role !== 'sdr'`, so the parameter is
    // accepted and then ignored for SDRs. Worth pinning: it is a silent denial, and a
    // refactor could easily turn it into a silent grant.
    const admin = await apiAs('director', baseURL!);
    const lead = await createLead(admin, { assignedToId: fixture().users.sdrA.id });
    await admin.delete(`/api/leads/${lead.id}`);

    const sdr = await apiAs('sdrA', baseURL!);
    const rows = await listLeads(sdr, 'archived=true&limit=500');
    expect(rows.map((r) => r.id), 'an SDR retrieved an archived lead').not.toContain(lead.id);
    await sdr.dispose();
    await admin.dispose();
  });
});

test.describe('limits', () => {
  test('limit is honoured and capped', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);

    const two = await listLeads(api, 'limit=2');
    expect(two.length, 'limit=2 returned more than two rows').toBeLessThanOrEqual(2);

    // `capLimit(raw, 200, 500)` — an absurd limit must be clamped, not obeyed, or one request
    // can pull the whole table.
    const huge = await listLeads(api, 'limit=100000');
    expect(huge.length, 'an unbounded limit was accepted').toBeLessThanOrEqual(500);
    await api.dispose();
  });

  test('a nonsensical limit does not empty the list', async ({ baseURL }) => {
    // A `limit=0` or negative that reached the query as-is would return nothing and look
    // exactly like "no data", which is the failure mode worth catching.
    const api = await apiAs('director', baseURL!);
    for (const value of ['0', '-5', 'abc']) {
      const rows = await listLeads(api, `limit=${value}`);
      expect(rows.length, `limit=${value} returned an empty list`).toBeGreaterThan(0);
    }
    await api.dispose();
  });
});
