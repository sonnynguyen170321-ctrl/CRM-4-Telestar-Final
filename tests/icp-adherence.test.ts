import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/**
 * ICP adherence (Task 8).
 *
 * The Leadgen Manager's dashboard could say how many leads were delivered against a target and
 * not whether they were the leads the client asked for. Volume and adherence are different
 * questions: a campaign can be 100% fulfilled and 40% on-ICP, and only the second predicts the
 * complaint.
 *
 * Database-backed, because the measurement is a join between delivered pool items, the CRM leads
 * they became, and the account/contact rows the criteria actually read. A mocked version would
 * assert that the matcher was called, which is not the part that can be wrong.
 */

// `icpAdherence` reaches the matcher through `lib/leadgen/qualification`, which imports the auth
// helpers; loading NextAuth for real in a Node test resolves `next/server` incorrectly.
vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { prisma } = await import('@/lib/prisma');
const { getIcpAdherence } = await import('@/lib/leadgen/icpAdherence');
const { runAs, setupWorkOrderFixture } = await import('./helpers/workOrderFixture');
type WorkOrderFixture = Awaited<ReturnType<typeof setupWorkOrderFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);

let fx: WorkOrderFixture;
const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('icpadh');
});

beforeEach(async () => {
  if (!hasDb) return;
  await run(async () => {
    await prisma.leadPoolItem.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.campaignLeadRequirement.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.lead.deleteMany({ where: { tenantId: fx.tenantId, company: 'ICP Target' } });
    await prisma.contact.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.account.deleteMany({ where: { tenantId: fx.tenantId } });
  });
});

interface Criteria {
  targetTitles?: string[];
  targetIndustries?: string[];
  targetCountries?: string[];
  companySizeMin?: number | null;
  companySizeMax?: number | null;
  requiredFields?: string[];
}

async function requirement(criteria: Criteria, requiredCount = 10) {
  return prisma.campaignLeadRequirement.create({
    data: {
      campaignId: fx.campaignId,
      requiredCount,
      targetTitles: criteria.targetTitles ?? [],
      targetIndustries: criteria.targetIndustries ?? [],
      targetCountries: criteria.targetCountries ?? [],
      companySizeMin: criteria.companySizeMin ?? null,
      companySizeMax: criteria.companySizeMax ?? null,
      requiredFields: criteria.requiredFields ?? [],
      status: 'open',
      createdById: fx.directorId,
      tenantId: fx.tenantId,
    },
  });
}

/** One delivered lead: an account, a contact, a CRM lead, and the pool item it came from. */
async function delivered(
  key: string,
  shape: {
    title?: string | null;
    industry?: string | null;
    country?: string | null;
    size?: number | null;
    phone?: string | null;
    /** Deliver the pool item without ever converting it to a CRM lead. */
    unconverted?: boolean;
  }
) {
  let leadId: string | null = null;

  if (!shape.unconverted) {
    const account = await prisma.account.create({
      data: {
        name: `ICP Co ${key}`,
        industry: shape.industry ?? null,
        country: shape.country ?? null,
        size: shape.size ?? null,
        tenantId: fx.tenantId,
      },
    });
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Pat',
        lastName: key,
        company: `ICP Co ${key}`,
        email: `icp-${key}@prospect.test`,
        title: shape.title ?? null,
        country: shape.country ?? null,
        phone: shape.phone ?? null,
        tenantId: fx.tenantId,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        firstName: 'Pat',
        lastName: key,
        company: 'ICP Target',
        email: `icp-${key}@prospect.test`,
        title: shape.title ?? null,
        phone: shape.phone ?? null,
        stage: 'new',
        assignedToId: fx.sdrId,
        campaignId: fx.campaignId,
        accountId: account.id,
        contactId: contact.id,
        tenantId: fx.tenantId,
      },
    });
    leadId = lead.id;
  }

  return prisma.leadPoolItem.create({
    data: {
      firstName: 'Pat',
      lastName: key,
      company: `ICP Co ${key}`,
      email: `icp-${key}@prospect.test`,
      sourceType: 'manual',
      status: 'assigned_to_campaign',
      assignedCampaignId: fx.campaignId,
      convertedLeadId: leadId,
      tenantId: fx.tenantId,
    },
  });
}

const only = (summary: Awaited<ReturnType<typeof getIcpAdherence>>) => summary.campaigns[0];

describe.skipIf(!hasDb)('ICP adherence measures delivered leads against the requirement', () => {
  it('counts a lead meeting every criterion as matched', async () => {
    await run(async () => {
      await requirement({ targetTitles: ['VP Sales'], targetCountries: ['Vietnam'] });
      await delivered('all-match', { title: 'VP Sales', country: 'Vietnam' });

      const row = only(await getIcpAdherence(fx.tenantId));
      expect(row.matched).toBe(1);
      expect(row.mismatched).toBe(0);
      expect(row.matchRate).toBe(100);
    });
  });

  it.each([
    ['title', { targetTitles: ['VP Sales'] }, { title: 'Office Manager', country: 'Vietnam' }],
    ['industry', { targetIndustries: ['SaaS'] }, { industry: 'Mining' }],
    ['country', { targetCountries: ['Vietnam'] }, { country: 'Peru' }],
    ['companySize', { companySizeMin: 50, companySizeMax: 500 }, { size: 4 }],
  ])('reports a %s mismatch as off-ICP, and names it', async (criterion, criteria, shape) => {
    await run(async () => {
      await requirement(criteria as Criteria);
      await delivered(`miss-${criterion}`, shape as Parameters<typeof delivered>[1]);

      const row = only(await getIcpAdherence(fx.tenantId));
      expect(row.mismatched).toBe(1);
      expect(row.matchRate).toBe(0);
      expect(row.topMismatchReasons[0]).toEqual({ criterion, count: 1 });
    });
  });

  it('reports a missing value as unknown rather than as a match', async () => {
    await run(async () => {
      await requirement({ targetCountries: ['Vietnam'] });
      await delivered('no-country', { title: 'VP Sales' });

      const row = only(await getIcpAdherence(fx.tenantId));
      // The whole point: silence is not agreement. Counting this as matched would inflate
      // adherence exactly where the data is worst.
      expect(row.unknown).toBe(1);
      expect(row.matched).toBe(0);
      expect(row.matchRate).toBe(0);
    });
  });

  it('treats a demonstrable failure as a mismatch even when another criterion is unknown', async () => {
    await run(async () => {
      await requirement({ targetTitles: ['VP Sales'], targetCountries: ['Vietnam'] });
      await delivered('miss-and-unknown', { title: 'Intern' });

      const row = only(await getIcpAdherence(fx.tenantId));
      expect(row.mismatched).toBe(1);
      expect(row.unknown).toBe(0);
    });
  });

  it('reports a missing mandatory field as a miss, named for a manager', async () => {
    await run(async () => {
      await requirement({ requiredFields: ['phone'] });
      await delivered('no-phone', { title: 'VP Sales' });

      const row = only(await getIcpAdherence(fx.tenantId));
      expect(row.mismatched).toBe(1);
      expect(row.topMismatchReasons[0].criterion).toBe('requiredField:phone');
    });
  });

  it('matches case-insensitively and on a partial title', async () => {
    await run(async () => {
      await requirement({ targetTitles: ['vp sales'], targetIndustries: ['saas'] });
      await delivered('case', { title: 'Senior VP Sales, EMEA', industry: 'SaaS Platforms' });

      expect(only(await getIcpAdherence(fx.tenantId)).matched).toBe(1);
    });
  });

  it('accepts any one of several allowed values', async () => {
    await run(async () => {
      await requirement({ targetCountries: ['Vietnam', 'Thailand', 'Malaysia'] });
      await delivered('multi', { country: 'Thailand' });

      expect(only(await getIcpAdherence(fx.tenantId)).matched).toBe(1);
    });
  });

  it('does not measure a campaign whose requirement names no criteria', async () => {
    await run(async () => {
      await requirement({});
      await delivered('unconstrained', { title: 'Anything at all' });

      const row = only(await getIcpAdherence(fx.tenantId));
      // Not 0%. A requirement that asks for nothing cannot be missed, and showing a zero would
      // read as a failing campaign rather than an unconfigured one.
      expect(row.hasCriteria).toBe(false);
      expect(row.matchRate).toBeNull();
      expect(row.mismatched).toBe(0);
      expect((await getIcpAdherence(fx.tenantId)).totals.evaluated).toBe(0);
    });
  });

  it('counts a delivered item that never became a CRM lead as unevaluated', async () => {
    await run(async () => {
      await requirement({ targetTitles: ['VP Sales'] });
      await delivered('converted', { title: 'VP Sales' });
      await delivered('never-converted', { unconverted: true });

      const row = only(await getIcpAdherence(fx.tenantId));
      expect(row.delivered).toBe(2);
      expect(row.unevaluated).toBe(1);
      // The unevaluable delivery is disclosed but stays out of the rate, which describes only
      // what could actually be judged.
      expect(row.evaluated).toBe(1);
      expect(row.matchRate).toBe(100);
    });
  });

  it('ranks the most common misses first', async () => {
    await run(async () => {
      await requirement({ targetTitles: ['VP Sales'], targetCountries: ['Vietnam'] });
      await delivered('rank-1', { title: 'Intern', country: 'Vietnam' });
      await delivered('rank-2', { title: 'Intern', country: 'Vietnam' });
      await delivered('rank-3', { title: 'VP Sales', country: 'Peru' });

      const row = only(await getIcpAdherence(fx.tenantId));
      expect(row.topMismatchReasons).toEqual([
        { criterion: 'title', count: 2 },
        { criterion: 'country', count: 1 },
      ]);
    });
  });

  it('never counts another tenant\'s deliveries', async () => {
    await run(async () => {
      await requirement({ targetTitles: ['VP Sales'] });
      await delivered('mine', { title: 'VP Sales' });

      const other = await getIcpAdherence(fx.otherTenantId);
      expect(other.campaigns).toHaveLength(0);
      expect(other.totals.evaluated).toBe(0);
    });
  });

  it('scopes to one campaign when asked', async () => {
    await run(async () => {
      await requirement({ targetTitles: ['VP Sales'] });
      await delivered('scoped', { title: 'VP Sales' });

      const scoped = await getIcpAdherence(fx.tenantId, { campaignId: fx.campaignId });
      expect(scoped.campaigns).toHaveLength(1);
      expect(await getIcpAdherence(fx.tenantId, { campaignId: 'no-such-campaign' })).toMatchObject({
        campaigns: [],
      });
    });
  });
});
