import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth, type SessionUser } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/authRoles';
import { prisma } from '@/lib/prisma';
import { logAdminAudit } from '@/lib/audit';
import { parseBody } from '@/lib/validation/core';

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

const isManager = (user: SessionUser) => (MANAGER_ROLES as readonly string[]).includes(user.role);
const canUseAnyMailbox = (user: SessionUser) => user.role === 'director' || user.role === 'floor_manager';

async function loadSequence(id: string, tenantId: string) {
  return prisma.sequence.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  const { id } = await params;
  const sequence = await loadSequence(id, user.tenantId);
  if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });

  const senders = await listSenders(id, user.tenantId);
  return NextResponse.json({
    senders: senders.map((row) => row.emailAccount),
    canEdit: isManager(user) || sequence.createdById === user.id,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  const tenantId = user.tenantId;

  const { id } = await params;
  const sequence = await loadSequence(id, tenantId);
  if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
  if (!isManager(user) && sequence.createdById !== user.id) {
    return NextResponse.json({ error: 'Only the sequence owner or a manager can change its senders' }, { status: 403 });
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
  if (!canUseAnyMailbox(user) && accounts.some((account) => account.userId !== user.id)) {
    return NextResponse.json({ error: 'You can only send from your own mailboxes' }, { status: 403 });
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
