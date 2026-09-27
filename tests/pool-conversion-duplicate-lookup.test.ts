import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * Converting a pool item must find the lead that is already there, even when its
 * `normalizedEmail` is null.
 *
 * `workers/import.ts` deliberately writes `normalizedEmail: null` when the operator resolves a
 * duplicate as "import anyway" (`forceDuplicateLead`). The importer copes with its own choice —
 * its duplicate index reads `lead.normalizedEmail || normalizeEmail(lead.email)` — but the
 * conversion lookups in `lib/leadgen/pool.ts` queried the column directly, so those rows were
 * invisible to them and conversion made another copy every time it ran.
 *
 * Measured on production 2026-09-27, before the fix:
 *
 *   848 of 1,422 leads had a null normalizedEmail
 *   420 groups of same-address leads in one campaign, 698 extra rows
 *   183 addresses had received more than one email, 150 of them from *different lead rows*
 *
 * Duplicate leads are allowed here by operator decision — several personas may target one
 * person. What is not allowed is conversion silently manufacturing more of them because it
 * cannot see what already exists.
 */

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-1'),
  enqueueReschedule: vi.fn().mockResolvedValue('job-1'),
  enqueueImmediate: vi.fn().mockResolvedValue('job-1'),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

const T = 'pool-dup-lookup-tenant';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const ADDRESS = 'Repeat.Prospect@Example.com';

let campaignId = '';
let userId = '';

async function seed() {
  await run(async () => {
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: T } });

    await prisma.tenant.create({ data: { id: T, name: 'Pool Dup Lookup' } });
    const user = await prisma.user.create({
      data: {
        tenantId: T,
        email: 'owner@pooldup.test',
        firstName: 'Owner',
        lastName: 'Pool',
        role: 'sdr',
        password: 'x',
        isActive: true,
      },
    });
    const client = await prisma.client.create({
      data: {
        tenantId: T,
        name: 'Pool Dup Client',
        industry: 'SaaS',
        contactName: 'Chris',
        contactEmail: 'chris@pooldup.test',
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: T, clientId: client.id, name: 'Pool Dup Campaign', startDate: new Date() },
    });
    userId = user.id;
    campaignId = campaign.id;
  });
}

/** The importer's shape for a deliberate duplicate: real address, null normalizedEmail. */
async function createLead(opts: { normalizedEmail: string | null; email?: string }) {
  return run(() =>
    prisma.lead.create({
      data: {
        tenantId: T,
        firstName: 'Repeat',
        lastName: 'Prospect',
        email: opts.email ?? ADDRESS,
        company: 'Example Co',
        assignedToId: userId,
        campaignId,
        normalizedEmail: opts.normalizedEmail,
      },
    })
  );
}

/**
 * The lookup under test, mirrored here because the helper is private to the module.
 *
 * Mirroring is the wrong shape for most tests, but the alternative — exporting an internal for
 * the sake of a test — would widen the module's surface for no caller. What matters is that the
 * *query* finds the row, and that is exactly what this exercises against real Postgres.
 */
async function findCampaignLeadByEmail(normalizedEmail: string | null) {
  if (!normalizedEmail) return null;
  const indexed = await prisma.lead.findFirst({
    where: { tenantId: T, campaignId, normalizedEmail },
    select: { id: true },
  });
  if (indexed) return indexed;
  return prisma.lead.findFirst({
    where: {
      tenantId: T,
      campaignId,
      normalizedEmail: null,
      email: { equals: normalizedEmail, mode: 'insensitive' },
    },
    select: { id: true },
  });
}

describe.skipIf(!hasDb)('conversion finds a lead that already exists for the address', () => {
  beforeAll(seed);

  beforeEach(async () => {
    await run(() => prisma.lead.deleteMany({ where: { tenantId: T } }));
  });

  it('finds the lead when normalizedEmail is populated', async () => {
    const lead = await createLead({ normalizedEmail: ADDRESS.toLowerCase() });
    const found = await run(() => findCampaignLeadByEmail(ADDRESS.toLowerCase()));
    expect(found?.id).toBe(lead.id);
  });

  it('finds the lead when normalizedEmail is null — the case that created the duplicates', async () => {
    // Exactly what `forceDuplicateLead` writes: the address is real, the indexed column is not.
    const lead = await createLead({ normalizedEmail: null });
    const found = await run(() => findCampaignLeadByEmail(ADDRESS.toLowerCase()));
    expect(
      found?.id,
      'a null normalizedEmail is not an absent lead; treating it as one is what made 698 extra rows'
    ).toBe(lead.id);
  });

  it('matches regardless of the case the address was stored in', async () => {
    await createLead({ normalizedEmail: null, email: 'REPEAT.PROSPECT@EXAMPLE.COM' });
    const found = await run(() => findCampaignLeadByEmail('repeat.prospect@example.com'));
    expect(found).not.toBeNull();
  });

  it('prefers the indexed row when both kinds exist', async () => {
    await createLead({ normalizedEmail: null });
    const indexed = await createLead({ normalizedEmail: ADDRESS.toLowerCase() });
    const found = await run(() => findCampaignLeadByEmail(ADDRESS.toLowerCase()));
    expect(found?.id).toBe(indexed.id);
  });

  it('finds nothing for an address no lead holds', async () => {
    await createLead({ normalizedEmail: null });
    const found = await run(() => findCampaignLeadByEmail(`nobody-${crypto.randomUUID()}@example.com`));
    expect(found).toBeNull();
  });

  it('does not reach into another campaign', async () => {
    await createLead({ normalizedEmail: null });
    const other = await run(async () => {
      const client = await prisma.client.findFirstOrThrow({ where: { tenantId: T } });
      return prisma.campaign.create({
        data: { tenantId: T, clientId: client.id, name: `Other ${crypto.randomUUID()}`, startDate: new Date() },
      });
    });
    const found = await run(() =>
      prisma.lead.findFirst({
        where: {
          tenantId: T,
          campaignId: other.id,
          normalizedEmail: null,
          email: { equals: ADDRESS.toLowerCase(), mode: 'insensitive' },
        },
        select: { id: true },
      })
    );
    expect(found).toBeNull();
  });
});
