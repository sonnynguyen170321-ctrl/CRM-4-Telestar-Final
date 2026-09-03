import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { backfillAccountIdentity } from '@/lib/identity/backfill';
import { prisma, tenantStorage } from '@/lib/prisma';

// Phase 1 taught the writers to key an Account on a normalised name and a canonical domain. Every row
// that existed before it is still keyed on the raw name, which is how one company became three
// Accounts with a third of its history each. This is the repair, and it is one-way on real data — so
// the properties that matter are that the dry run writes nothing, that the survivor is chosen for a
// stated reason, and that nothing is orphaned by the merge.

const TENANT = 'identity-backfill-tenant';
const OWNER_ID = 'identity-backfill-owner';
let campaignId: string;

function asTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
}

async function seedDuplicateCompany(marker: string) {
  // Three spellings of one company, exactly as an upload produces them: the legal form written three
  // ways, and only one row carrying the website.
  const withDomain = await prisma.account.create({
    data: { tenantId: TENANT, name: `Công ty TNHH ${marker}`, website: `https://${marker}.com.vn` },
    select: { id: true },
  });
  const shortForm = await prisma.account.create({
    data: { tenantId: TENANT, name: `CTY TNHH ${marker}` },
    select: { id: true },
  });
  const latin = await prisma.account.create({
    data: { tenantId: TENANT, name: `Cong ty TNHH ${marker}` },
    select: { id: true },
  });
  return { withDomain, shortForm, latin };
}

describe('identity backfill', () => {
  beforeAll(async () => {
    await prisma.tenant.upsert({
      where: { id: TENANT },
      create: { id: TENANT, name: 'Identity backfill tests' },
      update: {},
    });
    // A Lead requires an assignee, so the fixture needs a real user row rather than a plausible id.
    await prisma.user.upsert({
      where: { email: 'backfill-owner@telestar.vn' },
      create: {
        id: OWNER_ID,
        email: 'backfill-owner@telestar.vn',
        password: 'not-a-real-hash',
        firstName: 'Backfill',
        lastName: 'Owner',
        role: 'sdr',
        tenantId: TENANT,
      },
      update: {},
    });
    // A Lead hangs off a campaign, which hangs off a client. The chain is the fixture's cost of
    // proving that a merge carries a lead over rather than orphaning it.
    const client = await prisma.client.upsert({
      where: { id: 'identity-backfill-client' },
      create: { id: 'identity-backfill-client', name: 'Backfill Client', industry: 'software', contactName: 'Backfill Contact', contactEmail: 'client@example.com', tenantId: TENANT },
      update: {},
    });
    const campaign = await prisma.campaign.upsert({
      where: { id: 'identity-backfill-campaign' },
      create: {
        id: 'identity-backfill-campaign',
        name: 'Backfill Campaign',
        clientId: client.id,
        startDate: new Date(),
        tenantId: TENANT,
      },
      update: {},
    });
    campaignId = campaign.id;
  });

  it('reports the merges without writing anything in a dry run', async () => {
    const marker = `dry${randomUUID().slice(0, 6)}`;
    const seeded = await seedDuplicateCompany(marker);

    const report = await asTenant(() =>
      backfillAccountIdentity({ db: prisma as never, tenantId: TENANT, dryRun: true })
    );

    const plan = report.mergePlans.find((p) => p.survivorName.includes(marker));
    expect(plan).toBeDefined();
    expect(plan?.losers).toHaveLength(2);

    // Nothing moved: all three rows are still there, and the identity columns are still empty.
    const stillThere = await prisma.account.findMany({
      where: { tenantId: TENANT, name: { contains: marker } },
      select: { id: true, nameNormalized: true },
    });
    expect(stillThere).toHaveLength(3);
    expect(stillThere.every((account) => account.nameNormalized === null)).toBe(true);
    expect(seeded.withDomain.id).toBeTruthy();
  });

  it('merges the duplicates and keeps the row that carries the domain', async () => {
    const marker = `mrg${randomUUID().slice(0, 6)}`;
    const seeded = await seedDuplicateCompany(marker);

    // A lead on a losing row: the merge has to carry it over, not orphan it.
    const lead = await prisma.lead.create({
      data: {
        tenantId: TENANT,
        firstName: 'Mai',
        lastName: 'Tran',
        email: `mai-${marker}@example.com`,
        company: `CTY TNHH ${marker}`,
        accountId: seeded.shortForm.id,
        assignedToId: OWNER_ID,
        campaignId,
      },
      select: { id: true },
    });

    const report = await asTenant(() =>
      backfillAccountIdentity({ db: prisma as never, tenantId: TENANT, dryRun: false })
    );

    const plan = report.mergePlans.find((p) => p.survivorName.includes(marker));
    expect(plan?.survivorId).toBe(seeded.withDomain.id);
    expect(plan?.reason).toBe('has_domain');

    const remaining = await prisma.account.findMany({
      where: { tenantId: TENANT, name: { contains: marker } },
      select: { id: true, canonicalDomain: true, nameNormalized: true },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(seeded.withDomain.id);
    expect(remaining[0].canonicalDomain).toBe(`${marker}.com.vn`);
    expect(remaining[0].nameNormalized).not.toBeNull();

    const movedLead = await prisma.lead.findFirstOrThrow({
      where: { id: lead.id },
      select: { accountId: true },
    });
    expect(movedLead.accountId).toBe(seeded.withDomain.id);
  });

  it('links a contact to its account and records the employment', async () => {
    const marker = `lnk${randomUUID().slice(0, 6)}`;
    const account = await prisma.account.create({
      data: { tenantId: TENANT, name: `Công ty CP ${marker}`, website: `https://${marker}.vn` },
      select: { id: true },
    });
    const contact = await prisma.contact.create({
      data: {
        tenantId: TENANT,
        firstName: 'Linh',
        lastName: 'Pham',
        email: `linh-${marker}@example.com`,
        // A different spelling of the same employer — the raw string is why the link was never made.
        company: `CTY CP ${marker}`,
        title: 'Operations Director',
      },
      select: { id: true },
    });

    await asTenant(() => backfillAccountIdentity({ db: prisma as never, tenantId: TENANT, dryRun: false }));

    const linked = await prisma.contact.findFirstOrThrow({
      where: { id: contact.id },
      select: { accountId: true, normalizedCompany: true, fullNameNormalized: true },
    });
    expect(linked.accountId).toBe(account.id);
    expect(linked.normalizedCompany).not.toBeNull();
    expect(linked.fullNameNormalized).not.toBeNull();

    const employment = await prisma.contactEmployment.findFirstOrThrow({
      where: { tenantId: TENANT, contactId: contact.id },
      select: { accountId: true, isCurrent: true, title: true },
    });
    expect(employment.accountId).toBe(account.id);
    expect(employment.isCurrent).toBe(true);
    expect(employment.title).toBe('Operations Director');
  });

  it('converges — a second apply pass changes nothing', async () => {
    const marker = `cnv${randomUUID().slice(0, 6)}`;
    await seedDuplicateCompany(marker);

    await asTenant(() => backfillAccountIdentity({ db: prisma as never, tenantId: TENANT, dryRun: false }));
    const second = await asTenant(() =>
      backfillAccountIdentity({ db: prisma as never, tenantId: TENANT, dryRun: false })
    );

    // The marker's group is gone from the plan, and nothing needs re-stamping.
    expect(second.mergePlans.find((p) => p.survivorName.includes(marker))).toBeUndefined();
    expect(second.accountsStamped).toBe(0);
    expect(second.contactsRenormalized).toBe(0);
  });

  it('does not merge companies that share a name but have different websites', async () => {
    const marker = `dif${randomUUID().slice(0, 6)}`;
    // Two real, different companies. A shared normalised name is not proof; the contradicting domains
    // are, which is why the name grouping only takes rows that have no domain of their own.
    const first = await prisma.account.create({
      data: { tenantId: TENANT, name: `Thanh Cong ${marker}`, website: `https://first-${marker}.com` },
      select: { id: true },
    });
    const second = await prisma.account.create({
      data: { tenantId: TENANT, name: `Thành Công ${marker}`, website: `https://second-${marker}.com` },
      select: { id: true },
    });

    await asTenant(() => backfillAccountIdentity({ db: prisma as never, tenantId: TENANT, dryRun: false }));

    const survivors = await prisma.account.findMany({
      where: { tenantId: TENANT, id: { in: [first.id, second.id] } },
      select: { id: true },
    });
    expect(survivors).toHaveLength(2);
  });
});
