import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

/**
 * "Send from" for a sequence (owner request: add sending emails for a sequence campaign).
 *
 * Before, a step sent from `emailAccount.findFirst({ userId: owner })` — no ordering, so an owner
 * with two mailboxes sent from whichever row came back. These pin the replacement: a sequence's
 * senders are used, an enrollment keeps the mailbox it started with, and nobody can put a
 * colleague's mailbox on a cadence unless they are a director or floor manager.
 */

const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const { NextResponse } = await import('next/server');
  // The real visibility helpers (getVisibleUserIds walks managerId in the database); only the
  // session is stubbed.
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { prisma, tenantStorage } from '@/lib/prisma';
import { resolveSendingMailbox } from '@/lib/sequences/sender';
import { PUT } from '@/app/api/sequences/[id]/senders/route';
import { createTestTenant } from './helpers/testTenant';

let tenantId: string;
let otherTenantId: string;
const ids = { owner: '', peer: '', director: '', sequence: '', lead: '', enrollment: '', boxOld: '', boxNew: '', peerBox: '', foreignBox: '' };

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function user(role: SessionUser['role']) {
  const row = await prisma.user.create({
    data: { tenantId, email: `${role}.${randomUUID()}@t.test`, firstName: role, lastName: 'U', password: 'x', role },
  });
  return row.id;
}

async function mailbox(userId: string, extra: Record<string, unknown> = {}, t = tenantId) {
  const row = await prisma.emailAccount.create({
    data: { tenantId: t, userId, email: `box.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true, ...extra },
  });
  return row.id;
}

function asUser(id: string, role: SessionUser['role']) {
  authUser.current = { id, email: `${id}@t.test`, firstName: 'A', lastName: 'B', role, tenantId } as SessionUser;
}

const put = (emailAccountIds: string[]) =>
  PUT(
    new NextRequest(`http://localhost/api/sequences/${ids.sequence}/senders`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailAccountIds }),
    }),
    { params: Promise.resolve({ id: ids.sequence }) }
  );

beforeEach(async () => {
  authUser.current = null;
  tenantId = `t-senders-${randomUUID()}`;
  otherTenantId = `t-senders-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Senders');
  await createTestTenant(otherTenantId, 'Senders other');

  await inTenant(async () => {
    ids.owner = await user('sdr');
    ids.peer = await user('sdr');
    ids.director = await user('director');
    const sequence = await prisma.sequence.create({ data: { tenantId, name: 'Email - Judy', createdById: ids.owner } });
    ids.sequence = sequence.id;
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
    const lead = await prisma.lead.create({
      data: { tenantId, firstName: 'Ann', lastName: 'L', email: `ann.${randomUUID()}@acme.test`, company: 'Acme', assignedToId: ids.owner, campaignId: campaign.id },
    });
    ids.lead = lead.id;
    const enrollment = await prisma.sequenceEnrollment.create({
      data: { tenantId, leadId: lead.id, sequenceId: sequence.id, status: 'active', currentStep: 1, occupancyKey: `${tenantId}:${lead.id}:${sequence.id}` },
    });
    ids.enrollment = enrollment.id;

    ids.boxOld = await mailbox(ids.owner, { createdAt: new Date('2026-01-01') });
    ids.boxNew = await mailbox(ids.owner, { createdAt: new Date('2026-06-01') });
    ids.peerBox = await mailbox(ids.peer);
  });
  await inTenant(async () => {
    const foreignUser = await prisma.user.create({
      data: { tenantId: otherTenantId, email: `f.${randomUUID()}@t.test`, firstName: 'F', lastName: 'U', password: 'x', role: 'sdr' },
    });
    ids.foreignBox = await mailbox(foreignUser.id, {}, otherTenantId);
  }, otherTenantId);
});

describe('resolveSendingMailbox', () => {
  const resolve = () =>
    inTenant(() =>
      resolveSendingMailbox({ tenantId, enrollmentId: ids.enrollment, sequenceId: ids.sequence, ownerUserId: ids.owner, now: new Date('2026-10-03T10:00:00Z') })
    );

  it('falls back to the owner\'s oldest active mailbox when the sequence has no senders — no longer arbitrary', async () => {
    expect((await resolve())?.id).toBe(ids.boxOld);
  });

  it('uses a sequence sender, choosing the one with the most of today\'s cap left, and fixes it on the enrollment', async () => {
    await inTenant(async () => {
      await prisma.emailAccount.update({
        where: { id: ids.boxOld },
        data: { dailyCap: 80, dailySendCount: 70, dailySendDate: new Date('2026-10-03T08:00:00Z') },
      });
      await prisma.sequenceSender.createMany({
        data: [
          { tenantId, sequenceId: ids.sequence, emailAccountId: ids.boxOld, addedById: ids.owner },
          { tenantId, sequenceId: ids.sequence, emailAccountId: ids.peerBox, addedById: ids.director },
        ],
      });
    });

    const chosen = await resolve();

    expect(chosen?.id).toBe(ids.peerBox);
    const enrollment = await inTenant(() => prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: ids.enrollment } }));
    expect(enrollment.senderAccountId).toBe(ids.peerBox);
  });

  it('keeps the enrollment on its mailbox for later steps, even when another sender has more room', async () => {
    await inTenant(async () => {
      await prisma.sequenceSender.createMany({
        data: [
          { tenantId, sequenceId: ids.sequence, emailAccountId: ids.boxOld, addedById: ids.owner },
          { tenantId, sequenceId: ids.sequence, emailAccountId: ids.boxNew, addedById: ids.owner },
        ],
      });
      await prisma.sequenceEnrollment.update({ where: { id: ids.enrollment }, data: { senderAccountId: ids.boxNew } });
      await prisma.emailAccount.update({
        where: { id: ids.boxNew },
        data: { dailyCap: 80, dailySendCount: 79, dailySendDate: new Date('2026-10-03T08:00:00Z') },
      });
    });

    // The thread stays on one address; the cap check downstream decides whether it sends today.
    expect((await resolve())?.id).toBe(ids.boxNew);
  });

  it('chooses again when the fixed mailbox was disconnected, rather than stalling the cadence', async () => {
    await inTenant(async () => {
      await prisma.sequenceSender.create({ data: { tenantId, sequenceId: ids.sequence, emailAccountId: ids.boxOld, addedById: ids.owner } });
      await prisma.sequenceEnrollment.update({ where: { id: ids.enrollment }, data: { senderAccountId: ids.boxNew } });
      await prisma.emailAccount.update({ where: { id: ids.boxNew }, data: { isActive: false } });
    });

    expect((await resolve())?.id).toBe(ids.boxOld);
    const enrollment = await inTenant(() => prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: ids.enrollment } }));
    expect(enrollment.senderAccountId).toBe(ids.boxOld);
  });
});

describe('PUT /api/sequences/[id]/senders', () => {
  it('lets the owner send from their own mailboxes', async () => {
    asUser(ids.owner, 'sdr');
    const res = await inTenant(() => put([ids.boxOld, ids.boxNew]));
    expect(res.status).toBe(200);
    expect((await res.json()).senders.map((s: { id: string }) => s.id).sort()).toEqual([ids.boxOld, ids.boxNew].sort());
  });

  it('refuses an owner who adds a colleague\'s mailbox — that would be sending as them', async () => {
    asUser(ids.owner, 'sdr');
    const res = await inTenant(() => put([ids.peerBox]));
    expect(res.status).toBe(403);
    expect(await inTenant(() => prisma.sequenceSender.count({ where: { sequenceId: ids.sequence } }))).toBe(0);
  });

  // A sequence is seen by its creator, the managers above them, and — once shared — everyone
  // (lib/visibility.ts). One a rep cannot see answers as if it did not exist.
  it('hides the sequence from a rep who does not own it', async () => {
    asUser(ids.peer, 'sdr');
    expect((await inTenant(() => put([ids.peerBox]))).status).toBe(404);
    expect(await inTenant(() => prisma.sequenceSender.count({ where: { sequenceId: ids.sequence } }))).toBe(0);
  });

  it('refuses a rep who can see a shared sequence but does not own it', async () => {
    await inTenant(() => prisma.sequence.update({ where: { id: ids.sequence }, data: { isShared: true } }));
    try {
      asUser(ids.peer, 'sdr');
      expect((await inTenant(() => put([ids.peerBox]))).status).toBe(403);
    } finally {
      await inTenant(() => prisma.sequence.update({ where: { id: ids.sequence }, data: { isShared: false } }));
    }
  });

  it('lets a director attach any mailbox in the tenant, and replace the list', async () => {
    asUser(ids.director, 'director');
    expect((await inTenant(() => put([ids.peerBox, ids.boxOld]))).status).toBe(200);
    const res = await inTenant(() => put([ids.boxOld]));
    expect((await res.json()).senders.map((s: { id: string }) => s.id)).toEqual([ids.boxOld]);
  });

  it('cannot attach a mailbox from another tenant, even as a director', async () => {
    asUser(ids.director, 'director');
    const res = await inTenant(() => put([ids.foreignBox]));
    expect(res.status).toBe(400);
  });
});
