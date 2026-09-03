import { prisma } from '@/lib/prisma';

import { resolveIcpVersionId, scorePoolItem } from './scorePoolItem';

/**
 * Score one pool record that has just arrived.
 *
 * Deliberately swallows its own failures. The record is already in the pool and the write that
 * produced it has already succeeded by the time this runs; letting a missing ICP or a malformed rule
 * set turn that into a failed row would lose the record to protect a number. A record with no
 * assessment reads as NOT SCORED, which is true, and a later rescore fills it in once the ICP exists.
 *
 * Shared by the CSV import worker and research promotion so an uploaded lead and a discovered lead
 * are judged by exactly the same path.
 */
export async function scoreImportedPoolItem(poolItemId: string, tenantId: string): Promise<void> {
  try {
    const item = await prisma.leadPoolItem.findFirst({
      where: { id: poolItemId, tenantId },
      select: {
        id: true, company: true, title: true, email: true, country: true,
        industry: true, website: true, accountId: true, assignedCampaignId: true,
      },
    });
    if (!item) return;

    const icpVersionId = await resolveIcpVersionId(tenantId, item.assignedCampaignId ?? null);
    if (!icpVersionId) return; // no ICP configured — NOT SCORED is the honest state

    const version = await prisma.icpVersion.findFirst({
      where: { id: icpVersionId, tenantId },
      select: { rulesJson: true },
    });
    if (!version?.rulesJson) return;

    await scorePoolItem({ tenantId, item, icpVersionId, rules: version.rulesJson as never });
  } catch (error) {
    console.error('[leadgen] scoring failed for pool item', poolItemId, error);
  }
}
