import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

/**
 * `tenantStorage.run(ctx, () => prisma.model.op(...))` must actually scope the query.
 *
 * It did not. A `PrismaPromise` is lazy: the request is sent, and the client extension's
 * `query` hook runs, only when something calls `.then()` on it. The callback above *returns*
 * the PrismaPromise and `run()` exits; the `await` happens outside, so the hook fires outside
 * the AsyncLocalStorage context, `getStore()` is undefined, and the extension falls back to the
 * session — or, with no session, short-circuits. The tenant the caller passed was never seen.
 *
 * Forty-five call sites use `run`; twenty-one of them in this exact shape. Among them:
 *
 *   - `lib/auth.ts` — the API-key lookup. In production it resolved no tenant, short-circuited
 *     to `null`, and every API-key request was a 401. The whole `/api/v1` integration surface
 *     was unreachable for its only real consumer.
 *   - the `/api/v1` writes, which were "wrapped" and believed safe.
 *   - `lib/client-reports/shareLinks.ts` recorded that `run({ bypassRls: true })` "does not work
 *     because Next splits the AsyncLocalStorage across chunks". It was this.
 *
 * Three shapes are pinned. The third is the one that was broken and is now made safe at the
 * root, in lib/tenant-context.ts, rather than by editing twenty-one call sites and hoping the
 * twenty-second is written correctly.
 */

const A = `als-a-${crypto.randomUUID().slice(0, 8)}`;
const B = `als-b-${crypto.randomUUID().slice(0, 8)}`;
let leadId = '';

beforeAll(async () => {
  await prisma.tenant.createMany({ data: [{ id: A, name: A }, { id: B, name: B }] });
  const user = await prisma.user.create({
    data: { email: `o@${A}.test`, password: 'x', firstName: 'O', lastName: 'D', role: 'director', tenantId: A },
  });
  const client = await prisma.client.create({
    data: { name: 'c', industry: 'i', contactName: 'n', contactEmail: `c@${A}.test`, status: 'active', tenantId: A },
  });
  const campaign = await prisma.campaign.create({
    data: { name: 'q', clientId: client.id, startDate: new Date(), status: 'active', tenantId: A },
  });
  const lead = await prisma.lead.create({
    data: {
      firstName: 'L', lastName: 'T', company: 'x', email: `l@${A}.test`, stage: 'new',
      assignedToId: user.id, campaignId: campaign.id, tenantId: A,
    },
  });
  leadId = lead.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } });
});

describe('tenantStorage.run scopes a Prisma query whatever shape the callback takes', () => {
  it('async () => await prisma …', async () => {
    const seen = await tenantStorage.run({ tenantId: B }, async () => await prisma.lead.findUnique({ where: { id: leadId } }));
    expect(seen).toBeNull();
  });

  it('async () => prisma …', async () => {
    const seen = await tenantStorage.run({ tenantId: B }, async () => prisma.lead.findUnique({ where: { id: leadId } }));
    expect(seen).toBeNull();
  });

  it('() => prisma …  — the lazy PrismaPromise shape used at twenty-one call sites', async () => {
    const seen = await tenantStorage.run({ tenantId: B }, () => prisma.lead.findUnique({ where: { id: leadId } }));
    expect(seen, 'the extension ran outside the tenant context and returned another tenant\'s row').toBeNull();
  });

  it('and still finds the row under its own tenant, so the scoping is not just "always null"', async () => {
    const seen = await tenantStorage.run({ tenantId: A }, () => prisma.lead.findUnique({ where: { id: leadId } }));
    expect(seen?.id).toBe(leadId);
  });

  it('returns the callback\'s resolved value, not a promise of a promise', async () => {
    const value = await tenantStorage.run({ tenantId: A }, () => Promise.resolve(42));
    expect(value).toBe(42);
    const plain = await tenantStorage.run({ tenantId: A }, () => 'sync');
    expect(plain).toBe('sync');
  });

  it('propagates a rejection rather than swallowing it', async () => {
    await expect(
      tenantStorage.run({ tenantId: A }, () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom');
  });
});
