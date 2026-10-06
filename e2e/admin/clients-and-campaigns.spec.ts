/**
 * §15 — clients and campaigns.
 *
 * These are the top of the data chain the whole product hangs off: `lead → campaign → client`
 * (`.claude/rules/auth-rbac.md`). Getting the write gate wrong here is worse than on a
 * lead, because a campaign is what scoping is computed *from* — `getVisibleCampaignIds` and
 * the account axis in `canAccessLead` both read it.
 *
 * Writes are `requireRole('floor_manager')` on every route; reads are `requireAuth` plus
 * per-role scoping. So the two things worth proving are that a Team Lead cannot write, and
 * that a read is scoped rather than global.
 */
import { test, expect } from '../support/test';
import { apiAs, readJson } from '../support/api';
import { fixture } from '../support/fixture';
import { uniqueSuffix } from '../support/ids';
import type { APIRequestContext } from '@playwright/test';

const stamp = () => `${Date.now()}${uniqueSuffix()}`;

async function createClient(api: APIRequestContext) {
  const s = stamp();
  const { status, body } = await readJson(
    await api.post('/api/clients', {
      data: {
        name: `PW_AUDIT_CLIENT_${s}`,
        industry: 'Testing',
        contactName: 'PW Audit',
        contactEmail: `pw.client.${s}@audit.test`,
      },
    })
  );
  expect(status, `client create failed: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);
  const envelope = body as { client?: { id: string }; id?: string };
  const id = envelope.client?.id ?? envelope.id;
  expect(id, `no client id in ${JSON.stringify(body).slice(0, 200)}`).toBeTruthy();
  return id!;
}

async function listIds(api: APIRequestContext, path: string, key: string) {
  const { status, body } = await readJson(await api.get(path));
  expect(status, `${path} failed`).toBe(200);
  const rows = (Array.isArray(body) ? body : (body as Record<string, unknown[]>)[key] ?? []) as {
    id?: string;
  }[];
  return rows.map((r) => r.id);
}

test.describe('clients', () => {
  test('a floor manager can create and edit a client, and it persists', async ({ baseURL }) => {
    const api = await apiAs('floorManager', baseURL!);
    const clientId = await createClient(api);

    const renamed = `PW_AUDIT_CLIENT_RENAMED_${stamp()}`;
    const { status } = await readJson(
      await api.put(`/api/clients/${clientId}`, {
        data: { name: renamed, industry: 'Testing', contactName: 'PW Audit', contactEmail: `pw.r.${stamp()}@audit.test` },
      })
    );
    expect(status, 'client update failed').toBeLessThan(300);

    const { body } = await readJson(await api.get(`/api/clients/${clientId}`));
    expect((body as { name?: string }).name, 'the rename did not persist').toBe(renamed);
    await api.dispose();
  });

  test('a team lead cannot create or edit a client', async ({ baseURL, recorder }) => {
    // requireRole('floor_manager') — a Team Lead outranks an SDR but is below the write gate.
    recorder.expectFailures(403);
    const api = await apiAs('teamLead', baseURL!);

    const create = await readJson(
      await api.post('/api/clients', {
        data: {
          name: `PW_AUDIT_CLIENT_DENIED_${stamp()}`,
          industry: 'Testing',
          contactName: 'PW Audit',
          contactEmail: `pw.denied.${stamp()}@audit.test`,
        },
      })
    );
    expect(create.status, `a team lead created a client (${create.status})`).toBe(403);

    const edit = await readJson(
      await api.put(`/api/clients/${fixture().clientA}`, {
        data: { name: 'PW_AUDIT_SHOULD_NOT_APPLY', industry: 'x', contactName: 'x', contactEmail: 'x@audit.test' },
      })
    );
    expect(edit.status, `a team lead edited a client (${edit.status})`).toBe(403);
    await api.dispose();
  });

  test('an SDR cannot create a client', async ({ baseURL, recorder }) => {
    recorder.expectFailures(403);
    const api = await apiAs('sdrA', baseURL!);
    const { status } = await readJson(
      await api.post('/api/clients', {
        data: {
          name: `PW_AUDIT_CLIENT_SDR_${stamp()}`,
          industry: 'Testing',
          contactName: 'PW Audit',
          contactEmail: `pw.sdrclient.${stamp()}@audit.test`,
        },
      })
    );
    expect(status, `an SDR created a client (${status})`).toBe(403);
    await api.dispose();
  });

  test('a tenant A client list never contains tenant B clients', async ({ baseURL }) => {
    const api = await apiAs('director', baseURL!);
    const ids = await listIds(api, '/api/clients', 'clients');
    expect(ids, 'a tenant B client appeared in tenant A list').not.toContain(fixture().clientB);
    await api.dispose();
  });
});

test.describe('campaigns', () => {
  test('a floor manager can create and edit a campaign, and it persists', async ({ baseURL }) => {
    const api = await apiAs('floorManager', baseURL!);
    const clientId = await createClient(api);
    const s = stamp();

    const created = await readJson(
      await api.post('/api/campaigns', {
        data: {
          name: `PW_AUDIT_CAMPAIGN_${s}`,
          clientId,
          targetVertical: 'SaaS',
          targetGeo: 'SEA',
          startDate: new Date().toISOString(),
        },
      })
    );
    expect(created.status, `campaign create failed: ${JSON.stringify(created.body).slice(0, 300)}`).toBeLessThan(300);
    const envelope = created.body as { campaign?: { id: string }; id?: string };
    const campaignId = envelope.campaign?.id ?? envelope.id;
    expect(campaignId).toBeTruthy();

    const renamed = `PW_AUDIT_CAMPAIGN_RENAMED_${s}`;
    const updated = await readJson(
      await api.put(`/api/campaigns/${campaignId}`, { data: { name: renamed, status: 'paused' } })
    );
    expect(updated.status, `campaign update failed: ${JSON.stringify(updated.body).slice(0, 200)}`).toBeLessThan(300);

    // `/api/campaigns` is scoped by `getVisibleCampaignIds` (CampaignSdr). The creator is made
    // the first member (2026-10-06), so the campaign is in their own list as well as a director's.
    const own = await listIds(api, '/api/campaigns', 'campaigns');
    expect(own, 'the creator cannot see the campaign they just created').toContain(campaignId);
    const admin = await apiAs('director', baseURL!);
    const ids = await listIds(admin, '/api/campaigns', 'campaigns');
    expect(ids, 'the new campaign is missing from the unrestricted list').toContain(campaignId);
    await admin.dispose();
    await api.dispose();
  });

  // Owner request, 2026-10-06: team leads edit and archive campaigns — their pod's, not others'.
  test('a team lead can create a campaign and edit it, but not one outside their pod', async ({ baseURL, recorder }) => {
    recorder.expectFailures(404);
    const api = await apiAs('teamLead', baseURL!);

    const create = await readJson(
      await api.post('/api/campaigns', {
        data: { name: `PW_AUDIT_CAMPAIGN_TL_${stamp()}`, clientId: fixture().clientA },
      })
    );
    expect(create.status, `a team lead could not create a campaign (${create.status})`).toBe(201);
    const createdId = (create.body as { id?: string }).id;
    const own = await listIds(api, '/api/campaigns', 'campaigns');
    expect(own, 'the team lead cannot see the campaign they just created').toContain(createdId);

    const renamed = `PW_AUDIT_CAMPAIGN_TL_RENAMED_${stamp()}`;
    const edit = await readJson(await api.put(`/api/campaigns/${createdId}`, { data: { name: renamed } }));
    expect(edit.status, `a team lead could not edit their own campaign (${edit.status})`).toBe(200);
    expect((edit.body as { name?: string }).name).toBe(renamed);

    // A campaign the director creates has no member from the team lead's pod: out of reach,
    // and answered like a missing one.
    const admin = await apiAs('director', baseURL!);
    const foreign = await readJson(
      await admin.post('/api/campaigns', { data: { name: `PW_AUDIT_CAMPAIGN_DIR_${stamp()}`, clientId: fixture().clientA } })
    );
    expect(foreign.status).toBe(201);
    const foreignId = (foreign.body as { id?: string }).id;
    const refused = await readJson(await api.put(`/api/campaigns/${foreignId}`, { data: { name: 'PW_AUDIT_NOPE' } }));
    expect(refused.status, `a team lead edited a campaign outside their pod (${refused.status})`).toBe(404);
    await admin.dispose();
    await api.dispose();
  });

  test('a campaign cannot be created against another tenant client', async ({
    baseURL,
    recorder,
  }) => {
    // The interesting cross-tenant write on this route: `clientId` is caller-supplied, so a
    // tenant A manager naming tenant B's client would attach a campaign across the boundary.
    recorder.expectFailures(400, 403, 404, 422);
    const api = await apiAs('floorManager', baseURL!);
    const name = `PW_AUDIT_CROSS_${stamp()}`;
    const { status } = await readJson(
      await api.post('/api/campaigns', { data: { name, clientId: fixture().clientB } })
    );
    expect(
      status,
      `a campaign was created against a foreign tenant client (${status})`
    ).toBeGreaterThanOrEqual(400);
    await api.dispose();

    // Status alone is not the property. What must not happen is the victim tenant seeing a
    // record it did not create, so check from their side.
    const victim = await apiAs('directorB', baseURL!);
    const { body } = await readJson(await victim.get(`/api/clients/${fixture().clientB}`));
    expect(
      JSON.stringify(body),
      'a campaign from another tenant is listed under this tenant client'
    ).not.toContain(name);
    await victim.dispose();
  });

  test('an SDR sees only campaigns they are a member of', async ({ baseURL }) => {
    // Reads are `requireAuth` + scoping rather than a role gate, so the scoping is the whole
    // control. sdrA is a member of campaign A and of nothing in tenant B.
    const api = await apiAs('sdrA', baseURL!);
    const ids = await listIds(api, '/api/campaigns', 'campaigns');
    expect(ids, 'an SDR cannot see their own campaign').toContain(fixture().campaignA);
    expect(ids, 'an SDR sees a campaign from another tenant').not.toContain(fixture().campaignB);
    await api.dispose();
  });
});
