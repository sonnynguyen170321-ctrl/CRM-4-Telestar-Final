import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

/**
 * Who may a pool manager hand a converted lead to?
 *
 * Not the same question as "who reports to them". `computeVisibleUserIds` walks
 * the `managerId` tree *downward*, and lead generation hangs off the director as
 * a sibling branch to the SDR floor — leadgen_manager -> leadgen, team_lead -> sdr.
 * A leadgen manager's subtree therefore contains no SDR at all, for any tenant
 * shaped this way, which made the department's entire purpose (route qualified
 * records to outreach reps) unreachable: the picker was empty and the convert
 * endpoint 403'd every SDR id it was handed.
 *
 * Assignment scope is a different relationship from management scope, so it gets
 * its own rule: the reps working the campaign the records are being routed into,
 * via `CampaignSdr`. That is the join the product already uses to say "these reps
 * work this client", and it keeps a leadgen manager from assigning into campaigns
 * they are not routing to.
 *
 * Fallback: a campaign with no `CampaignSdr` rows yet resolves to every active SDR
 * in the tenant. Without it, a brand-new campaign would be unroutable — the same
 * dead end in a different place. Directors and floor managers keep their existing
 * wider reach.
 */

const WIDE_SCOPE_ROLES = new Set(['director', 'floor_manager']);

/** Active SDRs attached to a campaign, or all active SDRs when it has none. */
export async function getAssignableRepIds(
  user: Pick<SessionUser, 'id' | 'role' | 'tenantId'>,
  campaignId?: string | null
): Promise<string[]> {
  const tenantId = user.tenantId;

  if (campaignId) {
    const attached = await prisma.campaignSdr.findMany({
      where: { campaignId, ...(tenantId ? { tenantId } : {}) },
      select: { userId: true },
    });

    if (attached.length > 0) {
      const ids = attached.map((row) => row.userId);
      const active = await prisma.user.findMany({
        where: { id: { in: ids }, isActive: true, ...(tenantId ? { tenantId } : {}) },
        select: { id: true },
      });
      if (active.length > 0) return active.map((u) => u.id);
    }
  }

  // No campaign given, or the campaign has nobody attached yet.
  const reps = await prisma.user.findMany({
    where: {
      isActive: true,
      role: WIDE_SCOPE_ROLES.has(user.role) ? { in: ['sdr', 'leadgen'] } : 'sdr',
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true },
  });

  return reps.map((u) => u.id);
}

/**
 * Guard for the convert/assign endpoints. Checked per submitted id so a
 * hand-crafted request cannot route records to a rep outside the campaign,
 * exactly as the previous `canAccessUser` loop intended.
 */
export async function canAssignToRep(
  user: Pick<SessionUser, 'id' | 'role' | 'tenantId'>,
  targetId: string,
  campaignId?: string | null
): Promise<boolean> {
  const allowed = await getAssignableRepIds(user, campaignId);
  return allowed.includes(targetId);
}
