import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, tenantStorage } from '@/lib/prisma';

// Integration test against a live database (DATABASE_URL). It builds every row it needs,
// so it runs on a freshly migrated, unseeded database — CI included.
//
// NAMING, corrected 2026-08-22: this suite was called "PostgreSQL Row-Level Security (RLS)",
// which it is not. There are no RLS policies in this system — production and the local database
// both report zero, and no migration has ever created one (TEL-P1-038). What is enforced, and
// what this file actually exercises, is the tenant scoping applied by the Prisma extension in
// lib/prisma.ts. That enforcement is real and this test is a real test of it; only the name was
// wrong, and a wrong name here had propagated into the certification's SEC claims.
describe.skipIf(!process.env.DATABASE_URL)('application-enforced tenant scoping (Prisma extension)', () => {
  const tenantAId = 'test-tenant-a';
  const tenantBId = 'test-tenant-b';

  beforeAll(async () => {
    // Setup test data with RLS bypassed
    await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      // Clean up previous test runs if any. Tenant is cascade-deleting, so the owned
      // user/client/campaign rows created below go with it.
      await prisma.lead.deleteMany({
        where: { tenantId: { in: [tenantAId, tenantBId] } },
      });
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantAId, tenantBId] } },
      });

      // Create test tenants
      await prisma.tenant.createMany({
        data: [
          { id: tenantAId, name: 'Tenant A' },
          { id: tenantBId, name: 'Tenant B' },
        ],
      });

      // Own the fixtures rather than borrowing them.
      //
      // This used to take `user.findFirst()` and `campaign.findFirst()` — whichever rows
      // happened to exist — and throw "Database must contain at least one User and one
      // Campaign" when there were none. That made the suite pass or fail on ambient state:
      // green on a seeded workstation, red on CI's fresh database, and silently testing
      // against a different user on every machine.
      const user = await prisma.user.create({
        data: {
          email: `rls-fixture-${tenantAId}@example.test`,
          password: 'not-a-real-credential',
          firstName: 'RLS',
          lastName: 'Fixture',
          tenantId: tenantAId,
        },
      });
      const client = await prisma.client.create({
        data: {
          name: 'RLS Fixture Client',
          industry: 'Testing',
          contactName: 'RLS Fixture',
          contactEmail: `rls-client-${tenantAId}@example.test`,
          tenantId: tenantAId,
        },
      });
      const campaign = await prisma.campaign.create({
        data: {
          name: 'RLS Fixture Campaign',
          clientId: client.id,
          startDate: new Date(),
          tenantId: tenantAId,
        },
      });

      // Create lead in Tenant A
      await prisma.lead.create({
        data: {
          firstName: 'John',
          lastName: 'TenantA',
          company: 'Company A',
          email: 'john@tenant-a.com',
          tenantId: tenantAId,
          assignedToId: user.id,
          campaignId: campaign.id,
        },
      });

      // Tenant B needs its own owner and campaign. This lead used to borrow tenant A's `user`
      // and `campaign` while declaring itself tenant B — a cross-tenant row, built by the
      // fixture of the suite that exists to prove tenants stay apart. The composite keys
      // Lead (assignedToId, tenantId) -> User and Lead (campaignId, tenantId) -> Campaign now
      // refuse it, which is how it came to light.
      const userB = await prisma.user.create({
        data: {
          email: `rls-fixture-${tenantBId}@example.test`,
          password: 'not-a-real-credential',
          firstName: 'RLS',
          lastName: 'FixtureB',
          tenantId: tenantBId,
        },
      });
      const clientB = await prisma.client.create({
        data: {
          name: 'RLS Fixture Client B',
          industry: 'Testing',
          contactName: 'RLS Fixture B',
          contactEmail: `rls-client-${tenantBId}@example.test`,
          tenantId: tenantBId,
        },
      });
      const campaignB = await prisma.campaign.create({
        data: {
          name: 'RLS Fixture Campaign B',
          clientId: clientB.id,
          startDate: new Date(),
          tenantId: tenantBId,
        },
      });

      // Create lead in Tenant B
      await prisma.lead.create({
        data: {
          firstName: 'Jane',
          lastName: 'TenantB',
          company: 'Company B',
          email: 'jane@tenant-b.com',
          tenantId: tenantBId,
          assignedToId: userB.id,
          campaignId: campaignB.id,
        },
      });
    });
  });

  afterAll(async () => {
    // Clean up test data with RLS bypassed
    await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      await prisma.lead.deleteMany({
        where: { tenantId: { in: [tenantAId, tenantBId] } },
      });
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantAId, tenantBId] } },
      });
    });
  });

  it('Tenant A should only retrieve Tenant A data', async () => {
    await tenantStorage.run({ tenantId: tenantAId }, async () => {
      const leads = await prisma.lead.findMany({
        where: { tenantId: { in: [tenantAId, tenantBId] } },
      });
      expect(leads.length).toBe(1);
      expect(leads[0].firstName).toBe('John');
      expect(leads[0].tenantId).toBe(tenantAId);
    });
  });

  it('Tenant B should only retrieve Tenant B data', async () => {
    await tenantStorage.run({ tenantId: tenantBId }, async () => {
      const leads = await prisma.lead.findMany({
        where: { tenantId: { in: [tenantAId, tenantBId] } },
      });
      expect(leads.length).toBe(1);
      expect(leads[0].firstName).toBe('Jane');
      expect(leads[0].tenantId).toBe(tenantBId);
    });
  });

  it('Bypassing RLS should retrieve data from both tenants', async () => {
    await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      const leads = await prisma.lead.findMany({
        where: { tenantId: { in: [tenantAId, tenantBId] } },
      });
      expect(leads.length).toBe(2);
    });
  });
});
