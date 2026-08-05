import { prisma } from '@/lib/prisma';
import { clearVisibleUserCache } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getManageScope, canManage, canManageUser } from '@/lib/admin/scope';
import { canOwnSdrWork, WORK_OWNER_ROLES } from '@/lib/admin/orgRules';
import { logAdminAudit } from '@/lib/audit';
import { invalidateList } from '@/lib/cache';

/**
 * Move a user's live work to another user.
 *
 * ── Why there is no `$transaction` here ──────────────────────────────────────
 * The Neon HTTP driver has no interactive transactions, and the `$extends`
 * wrappers in `lib/prisma.ts` `await query(args)` internally, which also defeats
 * `$transaction([...])` array batching. Wrapping this function in a transaction
 * would LOOK correct and silently not be atomic. Do not "fix" it that way.
 *
 * Instead every phase is one `updateMany` whose `where` still names the FROM
 * user, which makes the whole operation idempotent and resumable:
 *   - a re-run moves only what has not moved yet
 *   - a partial failure leaves work owned by a real, active user — never orphaned
 *   - an intent audit row is written BEFORE any mutation, so a crash is visible
 *
 * Replay protection keys on `requestId`, stored as the audit row's `recordId`
 * so the existing `AuditLog @@index([tableName, recordId])` covers the lookup.
 */

const CHUNK = 500;
const MAX_ROWS_PER_ENTITY = 2000;
const AUDIT_TABLE = 'WorkTransfer';

export type TransferInclude = {
  leads: boolean;
  openTasks: boolean;
  scheduledMeetings: boolean;
  openOpportunities: boolean;
};

export type TransferRequest = {
  fromUserId: string;
  toUserId: string;
  campaignId?: string;
  include: TransferInclude;
  /** Client-generated idempotency key. A retry with the same value is safe. */
  requestId: string;
  reason: string;
};

export type TransferCounts = {
  leads: number;
  tasks: number;
  meetings: number;
  opportunities: number;
};

export type TransferResult = {
  ok: true;
  requestId: string;
  counts: TransferCounts;
  /** Tasks the send cron had claimed. Left with the original owner on purpose. */
  skippedLockedTasks: number;
  /** True when the per-entity cap was hit — re-POST the same requestId to continue. */
  hasMore: boolean;
  replayed: boolean;
};

export type TransferFailure = { ok: false; status: number; error: string };

export async function transferWork(
  actor: SessionUser,
  req: TransferRequest
): Promise<TransferResult | TransferFailure> {
  const { fromUserId, toUserId, campaignId, include, requestId, reason } = req;

  if (fromUserId === toUserId) {
    return { ok: false, status: 400, error: 'Source and destination must be different users.' };
  }

  // ── Authorization, entirely before any write (runtime-hardening rule) ──────
  const scope = await getManageScope(actor);
  if (scope.kind === 'none') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const inScope = campaignId
    ? canManage(scope, fromUserId, campaignId) && canManage(scope, toUserId, campaignId)
    : canManageUser(scope, fromUserId) && canManageUser(scope, toUserId);
  if (!inScope) {
    return { ok: false, status: 403, error: 'Both users must be within your management scope.' };
  }

  const [fromUser, toUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: fromUserId }, select: { id: true, isActive: true } }),
    prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, role: true, isActive: true, firstName: true, lastName: true },
    }),
  ]);
  if (!fromUser) return { ok: false, status: 404, error: 'Source user not found.' };
  if (!toUser) return { ok: false, status: 404, error: 'Destination user not found.' };
  if (!toUser.isActive) {
    return { ok: false, status: 400, error: 'Cannot transfer work to a deactivated user.' };
  }
  if (!canOwnSdrWork(toUser.role)) {
    return {
      ok: false,
      status: 400,
      error:
        `A ${toUser.role} cannot own SDR work — leads assigned to a leadgen user are scoped ` +
        `by campaign, not by assignee, so they would disappear from every work queue. ` +
        `Choose one of: ${WORK_OWNER_ROLES.join(', ')}.`,
    };
  }

  // ── Replay guard ──────────────────────────────────────────────────────────
  const completed = await prisma.auditLog.findFirst({
    where: { tableName: AUDIT_TABLE, recordId: requestId, action: 'admin.work.transfer' },
    select: { changedFields: true },
  });
  if (completed) {
    const stored = (completed.changedFields ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      requestId,
      counts: (stored.counts as TransferCounts) ?? emptyCounts(),
      skippedLockedTasks: Number(stored.skippedLockedTasks ?? 0),
      hasMore: Boolean(stored.hasMore),
      replayed: true,
    };
  }

  // ── Intent row, written before anything mutates ───────────────────────────
  await logAdminAudit({
    actorId: actor.id,
    action: 'admin.work.transfer.start',
    tableName: AUDIT_TABLE,
    recordId: requestId,
    targetUserId: fromUserId,
    reason,
    changedFields: { requestId, fromUserId, toUserId, campaignId: campaignId ?? null, include },
  });

  // The destination must be able to SEE the campaign before it owns rows in it,
  // otherwise the work lands somewhere they cannot open.
  if (campaignId) {
    await prisma.campaignSdr.upsert({
      where: { campaignId_userId: { campaignId, userId: toUserId } },
      create: { campaignId, userId: toUserId },
      update: {},
    });
    await invalidateList(actor.tenantId, 'campaigns');
    clearVisibleUserCache();
  }

  const counts = emptyCounts();
  let skippedLockedTasks = 0;
  let hasMore = false;

  // Snapshot the lead ids once. Task has no campaignId, so campaign-scoped task
  // work has to ride this list — never `where: { lead: { campaignId } }` on a
  // bulk write, which no index covers.
  const leadRows = await prisma.lead.findMany({
    where: {
      assignedToId: fromUserId,
      archivedAt: null,
      stage: { notIn: ['won', 'lost'] },
      ...(campaignId ? { campaignId } : {}),
    },
    select: { id: true },
    take: MAX_ROWS_PER_ENTITY + 1,
  });
  const leadIds = leadRows.slice(0, MAX_ROWS_PER_ENTITY).map((l) => l.id);
  if (leadRows.length > MAX_ROWS_PER_ENTITY) hasMore = true;

  // 1. Tasks — before the leads move, and only ones the cron has not claimed.
  if (include.openTasks && leadIds.length > 0) {
    for (const chunk of chunked(leadIds)) {
      skippedLockedTasks += await prisma.task.count({
        where: {
          leadId: { in: chunk },
          userId: fromUserId,
          status: 'pending',
          lockedAt: { not: null },
        },
      });
    }
    for (const chunk of chunked(leadIds)) {
      const res = await prisma.task.updateMany({
        where: { leadId: { in: chunk }, userId: fromUserId, status: 'pending', lockedAt: null },
        data: { userId: toUserId },
      });
      counts.tasks += res.count;
    }
  }

  // 2. Leads
  if (include.leads && leadIds.length > 0) {
    for (const chunk of chunked(leadIds)) {
      const res = await prisma.lead.updateMany({
        where: { id: { in: chunk }, assignedToId: fromUserId },
        data: { assignedToId: toUserId },
      });
      counts.leads += res.count;
    }
  }

  // 3. Meetings — only live ones. `outcomeLoggedById` stays put: it is history.
  if (include.scheduledMeetings) {
    const res = await prisma.meeting.updateMany({
      where: {
        sdrId: fromUserId,
        status: { in: ['scheduled', 'link_sent'] },
        scheduledAt: { gte: new Date() },
        ...(campaignId ? { campaignId } : {}),
      },
      data: { sdrId: toUserId },
    });
    counts.meetings = res.count;
  }

  // 4. Opportunities — `createdById` stays put for the same reason.
  if (include.openOpportunities) {
    const res = await prisma.opportunity.updateMany({
      where: { ownerId: fromUserId, status: 'open', ...(campaignId ? { campaignId } : {}) },
      data: { ownerId: toUserId },
    });
    counts.opportunities = res.count;
  }

  // ── Trails ────────────────────────────────────────────────────────────────
  // One Activity for the whole transfer, not one per lead. ActivityType has no
  // `work_transferred` value and a migration is not worth it for a rare admin
  // action — per-lead traceability lives on the audit row's lead id list.
  await prisma.activity.create({
    data: {
      userId: actor.id,
      type: 'lead_reassigned',
      description: `Bulk work transfer — ${counts.leads} lead(s), ${counts.tasks} task(s)`,
      metadata: {
        kind: 'bulk_transfer',
        requestId,
        fromUserId,
        toUserId,
        campaignId: campaignId ?? null,
        counts,
        skippedLockedTasks,
      },
    },
  });

  await logAdminAudit({
    actorId: actor.id,
    action: 'admin.work.transfer',
    tableName: AUDIT_TABLE,
    recordId: requestId,
    targetUserId: fromUserId,
    reason,
    changedFields: {
      requestId,
      fromUserId,
      toUserId,
      campaignId: campaignId ?? null,
      counts,
      skippedLockedTasks,
      hasMore,
      leadIds: leadIds.slice(0, 500),
    },
  });

  await notifyTransfer({ fromUserId, toUserId, counts, campaignId });

  clearVisibleUserCache();

  return { ok: true, requestId, counts, skippedLockedTasks, hasMore, replayed: false };
}

/** One notification per affected user — never one per lead. */
async function notifyTransfer(input: {
  fromUserId: string;
  toUserId: string;
  counts: TransferCounts;
  campaignId?: string;
}): Promise<void> {
  const { fromUserId, toUserId, counts } = input;
  const total = counts.leads + counts.tasks + counts.meetings + counts.opportunities;
  if (total === 0) return;

  const summary =
    `${counts.leads} lead(s), ${counts.tasks} task(s), ` +
    `${counts.meetings} meeting(s), ${counts.opportunities} opportunity(ies)`;

  try {
    await prisma.notification.createMany({
      data: [
        {
          userId: toUserId,
          type: 'work_transferred',
          title: 'Work transferred to you',
          text: `You have been assigned ${summary}.`,
          linkTo: '/',
        },
        {
          userId: fromUserId,
          type: 'work_transferred',
          title: 'Work transferred from you',
          text: `${summary} moved to another rep.`,
          linkTo: '/',
        },
      ],
    });
  } catch (err) {
    console.error('[transferWork] Failed to write transfer notifications:', err);
  }
}

function emptyCounts(): TransferCounts {
  return { leads: 0, tasks: 0, meetings: 0, opportunities: 0 };
}

function* chunked(ids: string[]): Generator<string[]> {
  for (let i = 0; i < ids.length; i += CHUNK) yield ids.slice(i, i + CHUNK);
}
