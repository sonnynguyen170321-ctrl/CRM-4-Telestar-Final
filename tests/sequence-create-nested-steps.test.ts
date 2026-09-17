/**
 * Creating a sequence with its steps, against the real database.
 *
 * `POST /api/sequences` stamped `tenantId` onto each nested `steps.create` entry. On
 * `SequenceStep` that column is the foreign key of three relations at once —
 *
 *     sequence  @relation(fields: [sequenceId, tenantId], references: [id, tenantId])
 *     template  @relation(fields: [templateId, tenantId], references: [id, tenantId])
 *     tenant    @relation(fields: [tenantId], references: [id])
 *
 * — so Prisma does not expose it as a scalar in a nested create; it comes from the parent. Every
 * attempt failed with `Unknown argument 'tenantId'`, and on 2026-09-17 a user pressed the copy
 * button on "Judy 1" six times in a row against six identical 500s.
 *
 * This runs against Postgres on purpose. A mocked client accepts any argument you hand it, which
 * is precisely why the route shipped: there was no test, and a mocked one would have passed.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'seq-create-actor',
    email: 'seq@telestar.test',
    firstName: 'Seq',
    lastName: 'Tester',
    role: 'director',
    tenantId: 'default-tenant',
  })),
  getVisibleUserIds: vi.fn(async () => null),
}));
vi.mock('@/lib/cache/invalidate', () => ({ invalidateList: vi.fn(async () => {}) }));

const { NextRequest } = await import('next/server');
const { prisma, tenantStorage } = await import('@/lib/prisma');
const { POST } = await import('@/app/api/sequences/route');

const TENANT = 'default-tenant';

async function ensureActor() {
  await tenantStorage.run({ tenantId: TENANT, bypassRls: true }, async () => {
    await prisma.user.upsert({
      where: { id: 'seq-create-actor' },
      update: {},
      create: {
        id: 'seq-create-actor',
        email: 'seq-create-actor@telestar.test',
        firstName: 'Seq',
        lastName: 'Tester',
        role: 'director',
        password: 'x',
        tenantId: TENANT,
      },
    });
  });
}

/**
 * In production the tenant reaches the Prisma extension through `requireAuth`, which is mocked
 * here; running the handler inside the same store is what makes this the request path rather than
 * a bare client call.
 */
const asRequest = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: TENANT }, fn);

const post = (body: unknown) =>
  new NextRequest(
    new Request('https://crm.test/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('POST /api/sequences', () => {
  it('creates a sequence together with its steps', async () => {
    await ensureActor();
    const name = `Copy target ${randomUUID().slice(0, 8)}`;

    const res = await asRequest(() =>
      POST(
      post({
        name,
        isActive: false,
        steps: [
          { order: 1, channel: 'email', delayDays: 0, delayHours: 0, instructions: 'Intro', autoComplete: true },
          { order: 2, channel: 'linkedin', delayDays: 2, delayHours: 0, instructions: 'Connect', autoComplete: false },
        ],
      })
      )
    );

    expect(res.status, 'duplicating a sequence must not 500').toBeLessThan(400);

    const created = await tenantStorage.run({ tenantId: TENANT, bypassRls: true }, () =>
      prisma.sequence.findFirst({
        where: { name, tenantId: TENANT },
        include: { steps: { orderBy: { order: 'asc' } } },
      })
    );

    expect(created).not.toBeNull();
    expect(created!.steps).toHaveLength(2);
    expect(created!.steps.map((s) => s.channel)).toEqual(['email', 'linkedin']);
    // The step's tenant comes down the relation from its parent. It is the same tenant either
    // way — the point is that it arrives without the route naming it.
    expect(created!.steps.every((s) => s.tenantId === TENANT)).toBe(true);
    expect(created!.steps.every((s) => s.sequenceId === created!.id)).toBe(true);
  });

  it('creates a sequence with no steps at all', async () => {
    await ensureActor();
    const name = `Empty ${randomUUID().slice(0, 8)}`;

    const res = await asRequest(() => POST(post({ name, steps: [] })));

    expect(res.status).toBeLessThan(400);
    const created = await tenantStorage.run({ tenantId: TENANT, bypassRls: true }, () =>
      prisma.sequence.findFirst({ where: { name, tenantId: TENANT }, include: { steps: true } })
    );
    expect(created!.steps).toHaveLength(0);
  });
});
