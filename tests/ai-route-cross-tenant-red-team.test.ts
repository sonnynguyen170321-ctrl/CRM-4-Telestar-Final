/**
 * TEL-P0-013 — two AI routes read a lead by id with no tenant filter, inside a scope
 * that has switched the automatic one off.
 *
 * `app/api/ai/enrich-lead/route.ts` and `app/api/ai/draft-reply/route.ts` both open
 * `tenantStorage.run({ tenantId, bypassRls: true })` and then query
 * `prisma.lead.findUnique({ where: { id: leadId } })`, where `leadId` arrives in the
 * request body. `lib/prisma.ts` says what `bypassRls` means, in its own words:
 *
 *     We deliberately do NOT add a tenantId WHERE-filter here, so cross-tenant reads
 *     (e.g. the worker's JobRun lookup before the tenant is known) keep working.
 *
 * So the extension's `where: { tenantId }` injection — which is the ONLY tenant
 * isolation this deployment has, since the database carries no RLS policies — is off
 * for exactly those queries. An authenticated user of one tenant can name another
 * tenant's lead id and receive it, together with the relations the routes include:
 * account, campaign, notes, activities, and five inbound and five outbound messages,
 * which are real prospect email bodies. The lead is then sent to an AI provider.
 *
 * The sibling routes get this right and are the model for the fix:
 * `calculateNextBestAction` uses `findFirst({ where: { id: leadId, tenantId } })`, and
 * `getWhatNeedsAttention` and `daily-briefing` filter every query by `tenantId`.
 *
 * These tests drive the real route handlers. Only the AI provider is mocked, and it is
 * mocked as a recorder: what a leak would hand to a third party is the exposure, so the
 * test asserts on the prompt the provider was given, not only on the HTTP body.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const generateStructured = vi.fn();
vi.mock('@/lib/ai/generation', () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { auth } = await import('@/auth');
const { ensureSessionUsers } = await import('./helpers/sessionUser');
const { NextRequest } = await import('next/server');
const { POST: enrichLead } = await import('@/app/api/ai/enrich-lead/route');
const { POST: draftReply } = await import('@/app/api/ai/draft-reply/route');

const VICTIM = 'tenant-ai-victim';
const ATTACKER = 'tenant-ai-attacker';
const VICTIM_LEAD = 'lead-ai-victim-secret';

/** Strings that exist only in the victim's tenant. Any of them reaching the attacker is the leak. */
const SECRET_COMPANY = 'Victim Holdings AG';
const SECRET_EMAIL = 'ceo@victim-holdings.test';

const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

describe.skipIf(!hasDb)('TEL-P0-013: AI routes must not read another tenant lead by id', () => {
  beforeAll(async () => {
    await runSystem(async () => {
      await prisma.lead.deleteMany({ where: { tenantId: { in: [VICTIM, ATTACKER] } } });
      await prisma.campaign.deleteMany({ where: { tenantId: { in: [VICTIM, ATTACKER] } } });
      await prisma.client.deleteMany({ where: { tenantId: { in: [VICTIM, ATTACKER] } } });
      await prisma.user.deleteMany({ where: { tenantId: { in: [VICTIM, ATTACKER] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [VICTIM, ATTACKER] } } });

      await prisma.tenant.create({ data: { id: VICTIM, name: 'Victim Holdings' } });
      await prisma.tenant.create({ data: { id: ATTACKER, name: 'Attacker Ltd' } });

      await prisma.user.create({
        data: {
          id: 'usr-ai-victim',
          tenantId: VICTIM,
          email: 'owner@victim-holdings.test',
          password: 'x',
          firstName: 'Val',
          lastName: 'Owner',
          role: 'sdr',
        },
      });
      await prisma.client.create({
        data: {
          id: 'client-ai-victim',
          tenantId: VICTIM,
          name: 'Victim Client',
          industry: 'Finance',
          contactName: 'V',
          contactEmail: 'vc@victim.test',
        },
      });
      await prisma.campaign.create({
        data: {
          id: 'camp-ai-victim',
          tenantId: VICTIM,
          clientId: 'client-ai-victim',
          name: 'Victim Campaign',
          startDate: new Date('2026-08-01'),
        },
      });
      await prisma.lead.create({
        data: {
          id: VICTIM_LEAD,
          tenantId: VICTIM,
          campaignId: 'camp-ai-victim',
          assignedToId: 'usr-ai-victim',
          firstName: 'Secret',
          lastName: 'Prospect',
          company: SECRET_COMPANY,
          email: SECRET_EMAIL,
          title: 'Chief Executive',
        },
      });
    });

    await ensureSessionUsers(
      {
        id: 'usr-ai-attacker',
        email: 'attacker@attacker.test',
        firstName: 'Mal',
        lastName: 'Ory',
        role: 'sdr',
        tenantId: ATTACKER,
      },
      {
        id: 'usr-ai-victim',
        email: 'owner@victim-holdings.test',
        firstName: 'Val',
        lastName: 'Owner',
        role: 'sdr',
        tenantId: VICTIM,
      },
    );
  });

  function actAsAttacker() {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: 'usr-ai-attacker',
        email: 'attacker@attacker.test',
        role: 'sdr',
        tenantId: ATTACKER,
      },
    } as never);
  }

  function post(url: string, body: unknown) {
    return new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  /** Everything the provider was shown, flattened, so a leak anywhere in the prompt is caught. */
  function everythingSentToTheProvider() {
    return generateStructured.mock.calls.map((call) => JSON.stringify(call)).join('\n');
  }

  beforeAll(() => {
    generateStructured.mockResolvedValue({
      companySummary: 'x',
      industryFocus: 'x',
      estimatedTechStack: [],
      keyPainPoints: [],
      icebreakers: [],
      intent: 'x',
      intentLabel: 'x',
      confidence: 1,
      options: [],
    });
  });

  it('enrich-lead does not return another tenant lead, and does not send it to the provider', async () => {
    actAsAttacker();
    generateStructured.mockClear();

    const response = await enrichLead(
      post('http://localhost/api/ai/enrich-lead', { leadId: VICTIM_LEAD }),
    );
    const payload = JSON.stringify(await response.json().catch(() => ({})));

    expect(payload).not.toContain(SECRET_COMPANY);
    expect(payload).not.toContain(SECRET_EMAIL);
    expect(everythingSentToTheProvider()).not.toContain(SECRET_COMPANY);
    expect(everythingSentToTheProvider()).not.toContain(SECRET_EMAIL);
  });

  it('draft-reply does not return another tenant lead, and does not send it to the provider', async () => {
    actAsAttacker();
    generateStructured.mockClear();

    const response = await draftReply(
      post('http://localhost/api/ai/draft-reply', {
        leadId: VICTIM_LEAD,
        messageText: 'hello',
        subject: 'hi',
      }),
    );
    const payload = JSON.stringify(await response.json().catch(() => ({})));

    expect(payload).not.toContain(SECRET_COMPANY);
    expect(payload).not.toContain(SECRET_EMAIL);
    expect(everythingSentToTheProvider()).not.toContain(SECRET_COMPANY);
    expect(everythingSentToTheProvider()).not.toContain(SECRET_EMAIL);
  });

  /**
   * The control for the two above, and it goes through the same route rather than
   * through Prisma directly — otherwise a fix that simply broke the lookup for
   * everybody would satisfy them. The owning tenant must still get its own lead.
   */
  it('the owning tenant still gets its own lead from the same route', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: 'usr-ai-victim',
        email: 'owner@victim-holdings.test',
        role: 'sdr',
        tenantId: VICTIM,
      },
    } as never);
    generateStructured.mockClear();

    const response = await enrichLead(
      post('http://localhost/api/ai/enrich-lead', { leadId: VICTIM_LEAD }),
    );
    const payload = JSON.stringify(await response.json().catch(() => ({})));

    expect(response.status).toBe(200);
    expect(payload).toContain(SECRET_COMPANY);
  });
});
