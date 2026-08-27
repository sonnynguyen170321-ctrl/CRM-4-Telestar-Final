import { vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(() => Promise.resolve(null)),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, tenantStorage } from '@/lib/prisma';
import { qualifyPoolItems } from '@/lib/leadgen/pool';
import type { SessionUser } from '@/lib/auth';

/**
 * "Duplicate" is offered by the console and accepted by the database, but was rejected by the API.
 *
 * `LeadQualificationStatus` has included `duplicate` since the pool shipped, and PoolBrowser lists
 * it in its qualification dropdown — but the route's zod enum omitted it, so pressing Duplicate
 * answered 400 "Invalid qualify request". Found 2026-08-27 while trying to retire six pool records
 * whose prospects were already leads in the target campaign.
 *
 * Status mapping matters too: everything that is not `qualified` or `needs_research` fell through
 * to `disqualified`, which asserts the record failed on merit. A duplicate did not fail; it is
 * simply already represented, so it leaves the working queue as `archived`.
 */
describe.skipIf(!process.env.DATABASE_URL)('qualifyPoolItems — duplicate', () => {
  const tenantId = 'pool-qualify-dupe-tenant';
  let actor: SessionUser;

  beforeAll(async () => {
    await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      await prisma.leadgenActivity.deleteMany({ where: { tenantId } });
      await prisma.leadPoolItem.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });

      await prisma.tenant.create({ data: { id: tenantId, name: 'Pool Qualify Dupe Tenant' } });
      const manager = await prisma.user.create({
        data: {
          email: 'mgr@poolqualify.test',
          password: 'hashed-password',
          firstName: 'Pool',
          lastName: 'Manager',
          role: 'leadgen_manager',
          tenantId,
        },
      });
      actor = {
        id: manager.id,
        email: manager.email,
        firstName: 'Pool',
        lastName: 'Manager',
        role: 'leadgen_manager',
        tenantId,
      } as SessionUser;
    });
  });

  afterAll(async () => {
    await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
      await prisma.leadgenActivity.deleteMany({ where: { tenantId } });
      await prisma.leadPoolItem.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    });
  });

  it('records a duplicate as duplicate, not as disqualified', async () => {
    await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
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

      await qualifyPoolItems({
        itemIds: [item.id],
        qualification: 'duplicate',
        actor,
        tenantId,
      });

      const after = await prisma.leadPoolItem.findUniqueOrThrow({
        where: { id: item.id },
        select: { qualification: true, status: true, disqualifiedReason: true },
      });

      expect(after.qualification).toBe('duplicate');
      // Archived, not disqualified: the record did not fail review, it is already represented.
      expect(after.status).toBe('archived');
      expect(after.disqualifiedReason).toBeNull();
    });
  });

  it('still routes a genuine disqualification to disqualified with its reason', async () => {
    await tenantStorage.run({ tenantId, bypassRls: false }, async () => {
      const item = await prisma.leadPoolItem.create({
        data: {
          firstName: 'Out',
          lastName: 'OfIcp',
          company: 'Tiny Co',
          email: 'out@tiny.test',
          sourceType: 'csv_import',
          tenantId,
        },
      });

      await qualifyPoolItems({
        itemIds: [item.id],
        qualification: 'disqualified',
        reason: 'below headcount floor',
        actor,
        tenantId,
      });

      const after = await prisma.leadPoolItem.findUniqueOrThrow({
        where: { id: item.id },
        select: { qualification: true, status: true, disqualifiedReason: true },
      });

      expect(after.qualification).toBe('disqualified');
      expect(after.status).toBe('disqualified');
      expect(after.disqualifiedReason).toBe('below headcount floor');
    });
  });
});
