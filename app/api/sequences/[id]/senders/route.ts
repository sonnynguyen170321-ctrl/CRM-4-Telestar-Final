import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getVisibleUserIds, requireAuth, type SessionUser } from '@/lib/auth';
import { canManageOwned, canViewOwned } from '@/lib/visibility';
import { prisma } from '@/lib/prisma';
import { logAdminAudit } from '@/lib/audit';
import { parseBody } from '@/lib/validation/core';
import { REAL_SEND } from '@/lib/sequences/performance';
import { remainingToday, senderState } from '@/lib/sequences/sender';

/**
 * The mailboxes a sequence sends from ("Send from"). See `lib/sequences/sender.ts` for how one is
 * chosen per enrollment.
 *
 * Who may change it, deliberately stricter than the sequence editor itself:
 *   - the sequence's creator or a manager (director, floor manager, team lead);
 *   - and every mailbox attached must belong to the caller, unless the caller is a director or
 *     floor manager — the same two roles `GET /api/email/accounts` shows every mailbox to.
 * A From line speaks for the person who connected the mailbox. Letting any rep put a colleague's
 * mailbox on their own cadence would let them send as that colleague.
 */

const putSchema = z.object({ emailAccountIds: z.array(z.string().min(1).max(64)).max(20) }).strict();

const canUseOthersMailboxes = (user: SessionUser) => user.role === 'director' || user.role === 'floor_manager';

/** The sequence, when the caller may see it (lib/visibility.ts); otherwise as if it did not exist. */
async function loadSequence(id: string, user: SessionUser) {
  const sequence = await prisma.sequence.findFirst({
    where: { id, tenantId: user.tenantId! },
    select: { id: true, createdById: true, isShared: true },
  });
  return sequence && (await canViewOwned(user, sequence)) ? sequence : null;
}

function listSenders(sequenceId: string, tenantId: string) {
  return prisma.sequenceSender.findMany({
    where: { sequenceId, tenantId },
    orderBy: { createdAt: 'asc' },
    select: {
      emailAccount: {
        select: { id: true, email: true, fromName: true, isActive: true, dailyCap: true, userId: true },
      },
    },
  });
}

/**
 * Each sender with what it is doing: its state, today's usage against its limit, and what this
 * sequence has sent through it. The panel used to show a tick box and an address, which answered
 * "which mailboxes are attached" and nothing about which of them was actually sending.
 *
 * `sentToday` is the mailbox's whole day across every sequence — it is the number its limit is
 * measured against. The per-sequence figures are counted from the rows, never from a counter.
 */
async function listSenderActivity(sequenceId: string, tenantId: string, viewer: { id: string; canEdit: boolean }) {
  const rows = await prisma.sequenceSender.findMany({
    where: { sequenceId, tenantId },
    orderBy: { createdAt: 'asc' },
    select: {
      emailAccount: {
        select: {
          id: true, email: true, fromName: true, isActive: true, dailyCap: true, userId: true,
          dailySendCount: true, dailySendDate: true, sendPausedAt: true, sendPauseReason: true,
          healthLevel: true, signature: true,
        },
      },
    },
  });
  const accountIds = rows.map((row) => row.emailAccount.id);
  if (accountIds.length === 0) return [];

  const [sent, assigned] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ['accountId'],
      where: { tenantId, sequenceId, accountId: { in: accountIds }, sentAt: { not: null }, ...REAL_SEND },
      _count: { _all: true },
      _max: { sentAt: true },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ['senderAccountId'],
      where: { tenantId, sequenceId, senderAccountId: { in: accountIds }, status: { in: ['active', 'paused'] } },
      _count: { _all: true },
    }),
  ]);
  const sentBy = new Map(sent.map((row) => [row.accountId, row]));
  const assignedTo = new Map(assigned.map((row) => [row.senderAccountId, row._count._all]));

  const now = new Date();
  return rows.map(({ emailAccount: account }) => {
    // A pause reason is free text a manager typed, and a missing signature is something only the
    // mailbox's owner or whoever runs this sequence can act on. Neither goes to a bystander.
    const privy = viewer.canEdit || account.userId === viewer.id;
    return {
      id: account.id,
      email: account.email,
      fromName: account.fromName,
      isActive: account.isActive,
      dailyCap: account.dailyCap,
      userId: account.userId,
      state: senderState(account, now),
      sentToday: Math.max(0, account.dailyCap - remainingToday(account, now)),
      sequenceSent: sentBy.get(account.id)?._count._all ?? 0,
      sequenceLastSentAt: sentBy.get(account.id)?._max.sentAt ?? null,
      sequenceLeads: assignedTo.get(account.id) ?? 0,
      ...(privy
        ? {
            pauseReason: account.sendPauseReason,
            // The designed signature is large and is not this panel's to show; whether one exists is.
            hasSignature: Boolean(account.signature && account.signature.trim()),
          }
        : {}),
    };
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  const { id } = await params;
  const sequence = await loadSequence(id, user);
  if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });

  const canEdit = await canManageOwned(user, sequence);
  return NextResponse.json({
    senders: await listSenderActivity(id, user.tenantId, { id: user.id, canEdit }),
    canEdit,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  const tenantId = user.tenantId;

  const { id } = await params;
  const sequence = await loadSequence(id, user);
  if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
  if (!(await canManageOwned(user, sequence))) {
    return NextResponse.json({ error: 'Only the sequence owner or their manager can change its senders' }, { status: 403 });
  }

  const parsed = await parseBody(req, putSchema, 'Invalid senders');
  if (parsed.error) return parsed.error;
  const wanted = Array.from(new Set(parsed.data.emailAccountIds));

  const accounts = await prisma.emailAccount.findMany({
    where: { id: { in: wanted }, tenantId },
    select: { id: true, userId: true },
  });
  if (accounts.length !== wanted.length) {
    return NextResponse.json({ error: 'One or more mailboxes were not found' }, { status: 400 });
  }
  // Your own mailboxes, or — for a director or floor manager, the two roles the mailbox list
  // shows other people's mailboxes to — those of the people under you. A mailbox already on the
  // sequence stays allowed, so saving a list a manager built does not fail on the mailboxes the
  // saver could not have added themselves.
  const already = new Set(
    (await prisma.sequenceSender.findMany({ where: { tenantId, sequenceId: id }, select: { emailAccountId: true } }))
      .map((row) => row.emailAccountId),
  );
  const reach = canUseOthersMailboxes(user) ? await getVisibleUserIds(user) : [user.id];
  const outOfReach = accounts.some(
    (account) => !already.has(account.id) && account.userId !== user.id && reach !== null && !reach.includes(account.userId),
  );
  if (outOfReach) {
    return NextResponse.json(
      { error: 'You can only add your own mailboxes, or those of people on your team' },
      { status: 403 }
    );
  }

  await prisma.$transaction([
    prisma.sequenceSender.deleteMany({
      where: { tenantId, sequenceId: id, emailAccountId: { notIn: wanted } },
    }),
    ...wanted.map((emailAccountId) =>
      prisma.sequenceSender.upsert({
        where: { sequenceId_emailAccountId: { sequenceId: id, emailAccountId } },
        create: { tenantId, sequenceId: id, emailAccountId, addedById: user.id },
        update: {},
      })
    ),
  ]);

  const senders = await listSenders(id, tenantId);
  await logAdminAudit({
    actorId: user.id,
    action: 'admin.sequence.senders',
    tableName: 'Sequence',
    recordId: id,
    // Mailbox ids, not addresses: the audit log is read more widely than the mailbox list.
    changedFields: { senderAccountIds: senders.map((row) => row.emailAccount.id) },
  });
  return NextResponse.json({ senders: senders.map((row) => row.emailAccount) });
}
