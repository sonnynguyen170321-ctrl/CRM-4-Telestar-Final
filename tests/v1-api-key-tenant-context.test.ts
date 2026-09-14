import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

/**
 * The `/api/v1` integration surface must work for a caller that has an API key and nothing else.
 *
 * That is its only real consumer — a VOIP dialer or an enrichment vendor posting from a server,
 * with a bearer token and no browser, so no session cookie. It did not work for them. Every
 * READ in these three routes ran outside `tenantStorage.run`, so the Prisma extension resolved
 * tenant from the NextAuth session, found none, and in production short-circuited the query to
 * `[]` / `null` before it ran. The `where: { tenantId }` the route had carefully built was never
 * used. `GET /api/v1/leads` returned zero rows, the dedupe on POST never matched so every
 * re-ingest created a duplicate, and `calls` / `enrich` returned 404 for leads that exist.
 *
 * The WRITES in the same files were wrapped, which is why a browser-driven smoke test passed:
 * with a session cookie present the extension resolved a tenant from the cookie instead, and
 * the routes appeared to work. Two callers, two behaviours, one of them the real one.
 *
 * These tests reproduce the real caller. The Prisma client is NOT mocked — every other test of
 * these routes mocks it, which is exactly why none of them could see this. `NODE_ENV` is set to
 * `production` around each call, because the short-circuit is production-only; under `test` the
 * extension falls back to a bypass and the bug does not reproduce.
 */

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(mockHeaders()) }));

// No cookie session at all — the API key is the only credential.
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { GET: getLeads } = await import('@/app/api/v1/leads/route');
const { POST: postCall } = await import('@/app/api/v1/calls/route');
const { POST: postEnrich } = await import('@/app/api/v1/enrich/route');

const TENANT = `v1-apikey-${crypto.randomUUID().slice(0, 8)}`;
const TOKEN = `tl_live_${crypto.randomBytes(24).toString('hex')}`;

let leadId = '';
let userId = '';

/** Run `fn` the way production runs it: no bypass, tenant must come from the request. */
async function asProduction<T>(fn: () => Promise<T>): Promise<T> {
  const env = { NODE_ENV: process.env.NODE_ENV, BYPASS_RLS: process.env.BYPASS_RLS };
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.BYPASS_RLS;
  try {
    return await fn();
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = env.NODE_ENV;
    if (env.BYPASS_RLS !== undefined) process.env.BYPASS_RLS = env.BYPASS_RLS;
  }
}

function bearer(url: string, init?: RequestInit) {
  mockHeaders.mockReturnValue(new Headers({ authorization: `Bearer ${TOKEN}` }));
  return new NextRequest(new Request(url, init));
}

beforeAll(async () => {
  await prisma.tenant.create({ data: { id: TENANT, name: 'v1 api-key tenant' } });

  const user = await prisma.user.create({
    data: {
      email: `owner@${TENANT}.test`,
      password: 'hashed-pwd',
      firstName: 'Owner',
      lastName: 'Director',
      role: 'director',
      tenantId: TENANT,
    },
  });
  userId = user.id;

  const client = await prisma.client.create({
    data: { name: 'Acme', industry: 'SaaS', contactName: 'A', contactEmail: `a@${TENANT}.test`, status: 'active', tenantId: TENANT },
  });
  const campaign = await prisma.campaign.create({
    data: { name: 'Q3', clientId: client.id, startDate: new Date(), status: 'active', tenantId: TENANT },
  });
  const lead = await prisma.lead.create({
    data: {
      firstName: 'Linh',
      lastName: 'Tran',
      company: 'Saigon Logistics',
      email: `linh@${TENANT}.test`,
      phone: '+84901234567',
      stage: 'new',
      assignedToId: user.id,
      campaignId: campaign.id,
      tenantId: TENANT,
    },
  });
  leadId = lead.id;

  await prisma.apiKey.create({
    data: {
      name: 'dialer',
      keyPrefix: `${TOKEN.slice(0, 12)}...`,
      keyHash: crypto.createHash('sha256').update(TOKEN).digest('hex'),
      scopes: ['leads:read', 'leads:write', 'calls:write', 'activities:write', 'enrich:write'],
      tenantId: TENANT,
      createdById: user.id,
    },
  });
});

afterAll(async () => {
  // The tenant helper cascades the rest.
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
});

describe('/api/v1 with an API key and no session', () => {
  it('GET /api/v1/leads returns the tenant\'s leads, not an empty list', async () => {
    const res = await asProduction(() => getLeads(bearer('https://crm.test/api/v1/leads')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.leads.map((l: { id: string }) => l.id)).toContain(leadId);
  });

  it('GET /api/v1/leads?email= finds the lead by email', async () => {
    const res = await asProduction(() =>
      getLeads(bearer(`https://crm.test/api/v1/leads?email=linh@${TENANT}.test`))
    );
    const body = await res.json();
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0].id).toBe(leadId);
  });

  it('POST /api/v1/calls finds the lead and logs the call, rather than 404', async () => {
    const res = await asProduction(() =>
      postCall(
        bearer('https://crm.test/api/v1/calls', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leadId, outcome: 'connected', durationSeconds: 90, notes: 'spoke to Linh' }),
        })
      )
    );
    expect(res.status, await res.text().catch(() => '')).not.toBe(404);
    expect(res.status).toBeLessThan(400);

    const activity = await prisma.activity.findFirst({ where: { leadId, tenantId: TENANT } });
    expect(activity).not.toBeNull();
    // The write must land in the API key's tenant — the ordinary failure mode here was a row
    // stamped with one tenant pointing at a lead in another.
    expect(activity!.tenantId).toBe(TENANT);
  });

  it('POST /api/v1/enrich finds the lead by email, rather than 404', async () => {
    const res = await asProduction(() =>
      postEnrich(
        bearer('https://crm.test/api/v1/enrich', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: `linh@${TENANT}.test`, personData: { title: 'Head of Operations' } }),
        })
      )
    );
    expect(res.status, await res.clone().text()).toBeLessThan(400);
    const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: TENANT } });
    expect(lead?.title).toBe('Head of Operations');
  });

  it('POST /api/v1/leads with an existing email updates it instead of creating a duplicate', async () => {
    const before = await prisma.lead.count({ where: { tenantId: TENANT, email: `linh@${TENANT}.test` } });
    const res = await asProduction(() =>
      import('@/app/api/v1/leads/route').then(({ POST }) =>
        POST(
          bearer('https://crm.test/api/v1/leads', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Linh', lastName: 'Tran', company: 'Saigon Logistics', email: `linh@${TENANT}.test` }),
          })
        )
      )
    );
    expect(res.status, await res.clone().text()).toBeLessThan(400);
    const after = await prisma.lead.count({ where: { tenantId: TENANT, email: `linh@${TENANT}.test` } });
    expect(after).toBe(before);
    expect(userId).toBeTruthy();
  });
});
