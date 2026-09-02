import { prisma } from '@/lib/prisma';

import { resolveIcpVersionId, scorePoolItem } from './scorePoolItem';

// Re-score pool records that already exist.
//
// Scoring happens at import, but records outlive the rules that judged them: an ICP is edited, a
// campaign is pointed at a different version, or a batch landed before any ICP was configured at all
// and sits NOT SCORED. This is how those catch up.
//
// It is a service and a route rather than a queue. A rescore is an operator action over a bounded
// selection, not a per-record event, and adding a job type would mean touching the queue registry,
// job options, the worker list and the generated queue map for something nothing enqueues
// automatically. If volume ever makes an inline pass too slow, the batching below is the seam a
// queue would plug into.

/** Bounded so one call cannot walk an entire tenant and hold a connection for minutes. */
export const RESCORE_BATCH_LIMIT = 500;

export type RescoreSelection =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'unscored' };

export type RescoreResult = {
  considered: number;
  scored: number;
  /** Assessments that already existed with the same fingerprint — the rules did not move them. */
  unchanged: number;
  /** Records with no ICP configured. Reported, never guessed at. */
  skippedNoIcp: number;
  failed: Array<{ poolItemId: string; reason: string }>;
};

function whereFor(selection: RescoreSelection, tenantId: string): Record<string, unknown> {
  switch (selection.kind) {
    case 'ids':
      return { tenantId, id: { in: selection.ids } };
    case 'campaign':
      return { tenantId, assignedCampaignId: selection.campaignId };
    case 'unscored':
      return { tenantId, latestAssessmentId: null };
  }
}

export async function rescorePool(params: {
  tenantId: string;
  selection: RescoreSelection;
  limit?: number;
}): Promise<RescoreResult> {
  const { tenantId, selection } = params;
  const take = Math.min(params.limit ?? RESCORE_BATCH_LIMIT, RESCORE_BATCH_LIMIT);

  const items = await prisma.leadPoolItem.findMany({
    where: whereFor(selection, tenantId) as never,
    orderBy: { createdAt: 'asc' },
    take,
    select: {
      id: true, company: true, title: true, email: true, country: true,
      industry: true, website: true, accountId: true, assignedCampaignId: true,
    },
  });

  const result: RescoreResult = {
    considered: items.length,
    scored: 0,
    unchanged: 0,
    skippedNoIcp: 0,
    failed: [],
  };

  // Rule sets are read once per version, not once per record: a batch of 500 records for one
  // campaign would otherwise re-read the same rules 500 times.
  const rulesCache = new Map<string, unknown | null>();

  for (const item of items) {
    try {
      const icpVersionId = await resolveIcpVersionId(tenantId, item.assignedCampaignId ?? null);
      if (!icpVersionId) {
        result.skippedNoIcp += 1;
        continue;
      }

      if (!rulesCache.has(icpVersionId)) {
        const version = await prisma.icpVersion.findFirst({
          where: { id: icpVersionId, tenantId },
          select: { rulesJson: true },
        });
        rulesCache.set(icpVersionId, version?.rulesJson ?? null);
      }
      const rules = rulesCache.get(icpVersionId);
      if (!rules) {
        result.skippedNoIcp += 1;
        continue;
      }

      const scored = await scorePoolItem({ tenantId, item, icpVersionId, rules: rules as never });
      if (scored.inserted) result.scored += 1;
      else result.unchanged += 1;
    } catch (error) {
      // One bad record must not abandon the rest of the batch, and the reason is reported rather
      // than logged and lost.
      result.failed.push({
        poolItemId: item.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
