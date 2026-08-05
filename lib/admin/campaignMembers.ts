import { prisma } from '@/lib/prisma';
import { clearVisibleUserCache } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getManageScope, canManage } from '@/lib/admin/scope';
import { computeUserImpact, type UserImpact } from '@/lib/admin/impact';
import { transferWork } from '@/lib/admin/transferWork';
import { pauseSequencesBulk } from '@/lib/sequences/engine';
import { logAdminAudit } from '@/lib/audit';
import { invalidateList } from '@/lib/cache';
import { randomUUID } from 'crypto';

/**
 * The single enforcement point for campaign membership.
 *
 * Both HTTP surfaces (`/api/admin/assignments` and
 * `/api/campaigns/[id]/members`) go through here, so the impact rule cannot be
 * bypassed by picking a different endpoint: a member who still owns live work is
 * never removed without the caller naming what happens to it.
 */

export type RemovalMode = 'keep_existing_work' | 'transfer_work' | 'pause_tasks';

export type RemoveMemberInput = {
  userId: string;
  campaignId: string;
  mode?: RemovalMode;
  transferToUserId?: string;
  reason?: string;
};

export type MemberOpFailure = { ok: false; status: number; error: string; impact?: UserImpact };
export type MemberOpSuccess = {
  ok: true;
  impact: UserImpact;
  mode: RemovalMode | 'none';
  transferred?: { leads: number; tasks: number; meetings: number; opportunities: number };
  paused?: { pausedLeads: number; skippedTasks: number; lockedTasks: number };
};

export async function addCampaignMember(
  actor: SessionUser,
  input: { userId: string; campaignId: string }
): Promise<{ ok: true } | MemberOpFailure> {
  const { userId, campaignId } = input;

  const scope = await getManageScope(actor);
  if (!canManage(scope, userId, campaignId)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const [target, campaign] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } }),
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } }),
  ]);
  if (!target) return { ok: false, status: 404, error: 'User not found' };
  if (!campaign) return { ok: false, status: 404, error: 'Campaign not found' };
  if (!target.isActive) {
    return { ok: false, status: 400, error: 'Cannot assign a deactivated user to a campaign.' };
  }

  // Idempotent on the composite PK [campaignId, userId].
  await prisma.campaignSdr.upsert({
    where: { campaignId_userId: { campaignId, userId } },
    create: { campaignId, userId },
    update: {},
  });

  // The campaigns list cache key embeds a scope hash derived from CampaignSdr,
  // so membership changes have to bust it.
  await invalidateList(actor.tenantId, 'campaigns');
  clearVisibleUserCache();

  await logAdminAudit({
    actorId: actor.id,
    action: 'admin.campaign.member_add',
    tableName: 'CampaignSdr',
    recordId: `${campaignId}:${userId}`,
    targetUserId: userId,
    changedFields: { campaignId, userId },
  });

  return { ok: true };
}

export async function removeCampaignMember(
  actor: SessionUser,
  input: RemoveMemberInput
): Promise<MemberOpSuccess | MemberOpFailure> {
  const { userId, campaignId, mode, transferToUserId, reason } = input;

  const scope = await getManageScope(actor);
  if (!canManage(scope, userId, campaignId)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const impact = await computeUserImpact({ userId, campaignId }, actor);

  // ── The rule this whole module exists for ─────────────────────────────────
  // Work still open and no decision made? Refuse, and hand back the numbers so
  // the UI can show them. 409, not 400: the request is well-formed, the state
  // is what makes it unacceptable.
  if (impact.totalOpen > 0 && !mode) {
    return {
      ok: false,
      status: 409,
      error: 'This member still owns open work. Choose what happens to it before removing them.',
      impact,
    };
  }

  if (impact.totalOpen > 0 && (!reason || reason.trim().length < 3)) {
    return {
      ok: false,
      status: 400,
      error: 'A reason is required when removing a member who owns open work.',
      impact,
    };
  }

  let transferred: MemberOpSuccess['transferred'];
  let paused: MemberOpSuccess['paused'];

  if (mode === 'transfer_work') {
    if (!transferToUserId) {
      return { ok: false, status: 400, error: 'Select a user to transfer the work to.', impact };
    }
    const result = await transferWork(actor, {
      fromUserId: userId,
      toUserId: transferToUserId,
      campaignId,
      include: {
        leads: true,
        openTasks: true,
        scheduledMeetings: true,
        openOpportunities: true,
      },
      requestId: randomUUID(),
      reason: reason ?? 'Campaign member removed',
    });
    if (!result.ok) return { ok: false, status: result.status, error: result.error, impact };
    transferred = result.counts;
  }

  if (mode === 'pause_tasks') {
    const leads = await prisma.lead.findMany({
      where: { assignedToId: userId, campaignId, archivedAt: null },
      select: { id: true },
    });
    paused = await pauseSequencesBulk(
      leads.map((l) => l.id),
      actor.id,
      reason ?? 'Campaign member removed'
    );
  }

  // `keep_existing_work` deliberately does nothing here — the member loses future
  // assignment but keeps what they already hold. Still audited with a reason.

  await prisma.campaignSdr.deleteMany({ where: { campaignId, userId } });

  await invalidateList(actor.tenantId, 'campaigns');
  clearVisibleUserCache();

  await logAdminAudit({
    actorId: actor.id,
    action: 'admin.campaign.member_remove',
    tableName: 'CampaignSdr',
    recordId: `${campaignId}:${userId}`,
    targetUserId: userId,
    reason,
    changedFields: {
      campaignId,
      userId,
      mode: mode ?? 'none',
      transferToUserId: transferToUserId ?? null,
      impactAtRemoval: {
        openLeads: impact.openLeads,
        openTasks: impact.openTasks,
        scheduledMeetings: impact.scheduledMeetings,
        openOpportunities: impact.openOpportunities,
      },
      transferred: transferred ?? null,
      paused: paused ?? null,
    },
  });

  return { ok: true, impact, mode: mode ?? 'none', transferred, paused };
}
