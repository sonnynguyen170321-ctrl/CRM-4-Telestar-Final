import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma, tenantStorage } from '@/lib/prisma';
import {
  buildRelationMap,
  forceTenantIdOnRelations,
  scrubForeignRelations,
  stripForcedFields,
} from '@/lib/tenant-includes';

/**
 * A relation reached through an `include` is not tenant-scoped by `applyScopedTenant`, which only
 * touches the top-level `where`. The include follows its foreign key wherever it points, so a row
 * whose FK crosses a tenant boundary discloses the foreign row's selected fields.
 *
 * Reproduced twice before the fix existed: through `GET /api/booking-links` with a mocked session,
 * and through `scripts/repro-nested-include-leak.ts` reading on the scoped path.
 *
 * The database case at the bottom is the one that matters — it fails against a client without the
 * nested scoping, and no amount of unit coverage substitutes for it. The unit cases above it pin
 * the two behaviours that are easy to get subtly wrong: a relation with no `tenantId` selected must
 * be left alone rather than guessed at, and a `tenantId` this layer forced into a selection must
 * not survive into the response.
 */

const models = Prisma.dmmf.datamodel.models as unknown as Parameters<typeof buildRelationMap>[0];
const RELATION_MAP = buildRelationMap(models);

const hasDb = Boolean(process.env.DATABASE_URL);

const TENANT_A = 'tincl-tenant-a';
const TENANT_B = 'tincl-tenant-b';
const CLIENT_B = 'tincl-client-b';
const LINK_A = 'tincl-link-a';
const CANARY = 'TINCL-TENANT-B-CLIENT';

const inTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);

describe('nested relation tenant scoping', () => {
  it('maps only relations whose target model carries a tenantId', () => {
    const bookingLink = RELATION_MAP.get('BookingLink');
    expect(bookingLink?.get('client')).toEqual({ type: 'Client', isList: false });
    expect(bookingLink?.get('meetings')).toEqual({ type: 'Meeting', isList: true });
    // `tenant` points at the Tenant model, which has no tenantId of its own — nothing to compare.
    expect(bookingLink?.has('tenant')).toBe(false);
  });

  it('forces tenantId into a to-one selection and filters a to-many include', () => {
    const args: Record<string, unknown> = {
      where: { id: 'x' },
      include: {
        client: { select: { id: true, name: true } },
        meetings: true,
      },
    };

    const forced = forceTenantIdOnRelations('BookingLink', args, TENANT_A, RELATION_MAP);

    const include = args.include as Record<string, any>;
    expect(include.client.select.tenantId).toBe(true);
    expect(include.meetings.where).toEqual({ tenantId: TENANT_A });
    expect(forced).toEqual([['client']]);
  });

  it('withholds a foreign to-one relation and keeps the row itself', () => {
    const row = {
      id: LINK_A,
      name: 'link',
      client: { id: CLIENT_B, name: CANARY, tenantId: TENANT_B },
    };

    const scrubbed = scrubForeignRelations('BookingLink', row, TENANT_A, RELATION_MAP);

    expect(scrubbed.client).toBeNull();
    expect(scrubbed.id).toBe(LINK_A);
  });

  it('leaves a relation alone when its tenantId was not selected', () => {
    // Nulling on a guess would break a legitimate relation, which is a visible product failure.
    const row = { id: LINK_A, client: { id: CLIENT_B, name: CANARY } };
    const scrubbed = scrubForeignRelations('BookingLink', row, TENANT_A, RELATION_MAP);
    expect(scrubbed.client).toEqual({ id: CLIENT_B, name: CANARY });
  });

  it('removes a forced tenantId so the response shape is what the caller asked for', () => {
    const rows = [{ id: LINK_A, client: { id: 'c', name: 'n', tenantId: TENANT_A } }];
    stripForcedFields(rows, [['client']]);
    expect(rows[0].client).toEqual({ id: 'c', name: 'n' });
  });

  describe.skipIf(!hasDb)('against a real database', () => {
    it('does not disclose a foreign relation through an include', async () => {
      for (const tenantId of [TENANT_A, TENANT_B]) {
        await inTenant(tenantId, async () => {
          await prisma.tenant.upsert({
            where: { id: tenantId },
            create: { id: tenantId, name: tenantId },
            update: {},
          });
        });
      }
      await inTenant(TENANT_B, async () => {
        await prisma.client.upsert({
          where: { id: CLIENT_B },
          create: {
            id: CLIENT_B,
            name: CANARY,
            industry: 'x',
            contactName: 'x',
            contactEmail: 'b@tincl.test',
            tenantId: TENANT_B,
          },
          update: { name: CANARY },
        });
      });
      // Owned by tenant A, pointing at tenant B — what a row written before the reference checks
      // existed looks like.
      await inTenant(TENANT_A, async () => {
        await prisma.bookingLink.upsert({
          where: { id: LINK_A },
          create: {
            id: LINK_A,
            clientId: CLIENT_B,
            name: 'poisoned',
            url: 'https://example.test/poisoned',
            tenantId: TENANT_A,
            isActive: true,
          },
          update: { clientId: CLIENT_B },
        });
      });

      try {
        // Read the way a request does: tenant known, RLS not bypassed. The callback must be async
        // and await here — returning the promise from a bare arrow loses the AsyncLocalStorage
        // context, the store arrives undefined, and the query silently takes the bypass path.
        const rows = await tenantStorage.run({ tenantId: TENANT_A, bypassRls: false }, async () => {
          return prisma.bookingLink.findMany({
            where: { id: LINK_A },
            include: { client: { select: { id: true, name: true } } },
          });
        });

        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).not.toContain(CANARY);
        expect((rows[0] as { client?: unknown }).client).toBeNull();
      } finally {
        await inTenant(TENANT_A, async () => {
          await prisma.bookingLink.deleteMany({ where: { tenantId: TENANT_A } });
        });
        await inTenant(TENANT_B, async () => {
          await prisma.client.deleteMany({ where: { tenantId: TENANT_B } });
        });
        for (const tenantId of [TENANT_B, TENANT_A]) {
          await inTenant(tenantId, async () => {
            await prisma.tenant.deleteMany({ where: { id: tenantId } });
          });
        }
      }
    });
  });
});
