import type { SessionUser } from '@/lib/auth';
import { canViewProfile } from '@/lib/leadgen/icpAccess';
import { prisma } from '@/lib/prisma';

/**
 * May this person start research from this ICP version?
 *
 * Research turns an ICP's rules into discovery queries and prospects, so reading the rules is what
 * is being authorized. The version must be published (a draft or a version in review is not live),
 * and either a shared library ICP or a custom one the caller can see (their own, or their chain's).
 * Another rep's personal ICP is as invisible here as it is in the ICP list: same answer as "no such
 * version", so its existence is not disclosed.
 */
export async function researchIcpAllowed(
  user: SessionUser,
  tenantId: string,
  icpVersionId: string,
): Promise<boolean> {
  const version = await prisma.icpVersion.findFirst({
    where: { id: icpVersionId, tenantId, status: 'published' },
    select: { icpProfile: { select: { kind: true, ownerUserId: true } } },
  });
  if (!version) return false;
  return canViewProfile(user, version.icpProfile);
}
