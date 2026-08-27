import { vi } from 'vitest';

// Mock @/auth to avoid loading next-auth inside Vitest, matching the other leadgen suites.
vi.mock('@/auth', () => ({
  auth: vi.fn(() => Promise.resolve(null)),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, tenantStorage } from '@/lib/prisma';
import { convertPoolToLeads } from '@/lib/leadgen/pool';
import type { SessionUser } from '@/lib/auth';

/**
 * A prospect already working in a campaign must not be convertible into it a second time.
 *
 * `Lead_tenant_campaign_email_uniq` (migration 20260623070000) allows one lead per
 * tenant + campaign + normalizedEmail. Convert used to discover this by letting
 * `prisma.lead.create()` throw, then storing the raw driver text — measured on production
 * 2026-08-27, where six of nine records failed with
 * "Unique constraint failed on the fields: (`tenantId`,`campaignId`,`normalizedEmail`)"
 * while the endpoint still answered 200. The manager saw "Converted (3)" and had no way to
 * learn that the other six were already Sonny's pipeline, one of them a closed win.
 *
 * The behaviour these tests pin: detect the collision first, name it, and say which lead
 * already holds the slot — without throwing and without creating anything.
 */
describe.skipIf(!process.env.DATABASE_URL)('convertPoolToLeads — existing lead in campaign', () => {
  const tenantId = 'pool-convert-dupe-tenant';
  let sdrId = '';
  let campaignId = '';
  let actor: SessionUser;

  beforeAll(async () => {
    await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      // Convert writes LeadgenActivity rows referencing the user, so they go first.
      await prisma.leadgenActivity.deleteMany({ where: { tenantId } });
      await prisma.leadPoolItem.deleteMany({ where: { tenantId } });
      await prisma.lead.deleteMany({ where: { tenantId } });
      await prisma.campaign.deleteMany({ where: { tenantId } });
      await prisma.client.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });

      await prisma.tenant.create({ data: { id: tenantId, name: 'Pool Convert Dupe Tenant' } });

      const manager = await prisma.user.create({
        data: {
          email: 'mgr@poolconvert.test',
          password: 'hashed-password',
          firstName: 'Priya',
          lastName: 'Manager',
          role: 'leadgen_manager',
          tenantId,
        },
      });

      const sdr = await prisma.user.create({
        data: {
          email: 'sdr@poolconvert.test',
          password: 'hashed-password',
          firstName: 'Alex',
          lastName: 'Rep',
          role: 'sdr',
          tenantId,
        },
      });
      sdrId = sdr.id;

      const client = await prisma.client.create({
        data: {
          name: 'Dupe Test Client',
          industry: 'Logistics',
          contactName: 'Dupe Contact',
          contactEmail: 'contact@poolconvert.test',
          tenantId,
        },
      });

      const campaign = await prisma.campaign.create({
        data: {
          name: 'Dupe Test Campaign',
          clientId: client.id,
          startDate: new Date(),
          tenantId,
        },
      });
      campaignId = campaign.id;

      actor = {
        id: manager.id,
        email: manager.email,
        firstName: 'Priya',
        lastName: 'Manager',
        role: 'leadgen_manager',
        tenantId,
      } as SessionUser;
    });
  });

  afterAll(async () => {
    await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      // Convert writes LeadgenActivity rows referencing the user, so they go first.
      await prisma.leadgenActivity.deleteMany({ where: { tenantId } });
      await prisma.leadPoolItem.deleteMany({ where: { tenantId } });
      await prisma.lead.deleteMany({ where: { tenantId } });
      await prisma.campaign.deleteMany({ where: { tenantId } });
      await prisma.client.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    });
  });

  it('reports a prospect already in the campaign as a duplicate instead of a driver error', async () => {
    await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
      const existing = await prisma.lead.create({
        data: {
          firstName: 'Travis',
          lastName: 'Chan',
          company: 'Veson',
          email: 'tchan@veson.com',
          normalizedEmail: 'tchan@veson.com',
          stage: 'won',
          assignedToId: sdrId,
          campaignId,
          tenantId,
        },
      });

      const item = await prisma.leadPoolItem.create({
        data: {
          firstName: 'Travis',
          lastName: 'Chan',
          company: 'Veson',
          email: 'tchan@veson.com',
          sourceType: 'csv_import',
          tenantId,
        },
      });

      const result = await convertPoolToLeads({
        itemIds: [item.id],
        campaignId,
        sdrIds: [sdrId],
        method: 'single',
        actor,
        tenantId,
      });

      expect(result.count).toBe(0);
      expect(result.errors).toHaveLength(1);

      const [failure] = result.errors;
      expect(failure.poolItemId).toBe(item.id);
      // The reason a human can act on — not "Invalid `prisma.lead.create()` invocation".
      expect(failure.reason).toBe('already_a_lead_in_this_campaign');
      expect(failure.existingLeadId).toBe(existing.id);
    });
  });

  it('leaves the existing lead untouched — its owner and stage are not reassigned', async () => {
    await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
      const leads = await prisma.lead.findMany({
        where: { tenantId, campaignId, normalizedEmail: 'tchan@veson.com' },
        select: { id: true, stage: true, assignedToId: true },
      });

      expect(leads).toHaveLength(1);
      expect(leads[0].stage).toBe('won');
      expect(leads[0].assignedToId).toBe(sdrId);
    });
  });

  it('still converts the records that do not collide', async () => {
    await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
      const fresh = await prisma.leadPoolItem.create({
        data: {
          firstName: 'Chloe',
          lastName: 'Ng',
          company: 'Northwind',
          email: 'chloe@northwind.test',
          sourceType: 'csv_import',
          tenantId,
        },
      });

      const result = await convertPoolToLeads({
        itemIds: [fresh.id],
        campaignId,
        sdrIds: [sdrId],
        method: 'single',
        actor,
        tenantId,
      });

      expect(result.count).toBe(1);
      expect(result.errors).toHaveLength(0);

      const lead = await prisma.lead.findFirst({
        where: { tenantId, campaignId, normalizedEmail: 'chloe@northwind.test' },
        select: { assignedToId: true },
      });
      expect(lead?.assignedToId).toBe(sdrId);
    });
  });
});
