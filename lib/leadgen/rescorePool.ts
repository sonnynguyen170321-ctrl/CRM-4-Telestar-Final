import { prisma } from "@/lib/prisma";

import {
  resolveIcpVersionId,
  resolvePoolPreRankVersionId,
  scorePoolItem,
} from "./scorePoolItem";

/**
 * Re-score immutable ICP assessments through campaign memberships.
 *
 * CampaignProspect is the unit of campaign scoring: it follows its campaign's ICP profile and a
 * campaign without an ICP is skipped (`skippedNoIcp`), never scored with the default. Only an
 * unassigned pool item is pre-ranked with the tenant default ICP, and one campaign's result is
 * never written as another campaign's truth.
 */
export const RESCORE_BATCH_LIMIT = 500;

export type RescoreSelection =
  | { kind: "ids"; ids: string[] }
  | { kind: "campaign"; campaignId: string }
  | { kind: "unscored" };

export type RescoreResult = {
  /** Campaign memberships (or unassigned pool records), not globally unique people. */
  considered: number;
  scored: number;
  unchanged: number;
  skippedNoIcp: number;
  failed: Array<{ poolItemId: string; campaignId?: string; reason: string }>;
};

type Target = {
  campaignId: string | null;
  item: {
    id: string;
    company: string;
    title: string | null;
    email: string | null;
    country: string | null;
    industry: string | null;
    website: string | null;
    accountId: string | null;
  };
};

const itemSelect = {
  id: true,
  company: true,
  title: true,
  email: true,
  country: true,
  industry: true,
  website: true,
  accountId: true,
} as const;

async function targetsFor(
  selection: RescoreSelection,
  tenantId: string,
  take: number,
): Promise<Target[]> {
  if (selection.kind === "campaign") {
    const memberships = await prisma.campaignProspect.findMany({
      where: {
        tenantId,
        campaignId: selection.campaignId,
        status: { not: "removed" },
      },
      orderBy: { addedAt: "asc" },
      take,
      select: {
        campaignId: true,
        poolItem: { select: itemSelect },
      },
    });
    return memberships.map((membership) => ({
      campaignId: membership.campaignId,
      item: membership.poolItem,
    }));
  }

  const items = await prisma.leadPoolItem.findMany({
    where:
      selection.kind === "ids"
        ? { tenantId, id: { in: selection.ids } }
        : {
            tenantId,
            latestAssessmentId: null,
            campaignProspects: {
              none: { tenantId, status: { not: "removed" } },
            },
          },
    orderBy: { createdAt: "asc" },
    take,
    select: {
      ...itemSelect,
      campaignProspects: {
        where: { tenantId, status: { not: "removed" } },
        select: { campaignId: true },
        orderBy: { addedAt: "asc" },
      },
    },
  });

  const targets: Target[] = [];
  for (const item of items) {
    const { campaignProspects, ...scorable } = item;
    if (campaignProspects.length === 0) {
      targets.push({ campaignId: null, item: scorable });
    } else {
      for (const membership of campaignProspects) {
        if (targets.length >= take) break;
        targets.push({ campaignId: membership.campaignId, item: scorable });
      }
    }
    if (targets.length >= take) break;
  }
  return targets;
}

export async function rescorePool(params: {
  tenantId: string;
  selection: RescoreSelection;
  limit?: number;
}): Promise<RescoreResult> {
  const { tenantId, selection } = params;
  const take = Math.min(
    params.limit ?? RESCORE_BATCH_LIMIT,
    RESCORE_BATCH_LIMIT,
  );
  const targets = await targetsFor(selection, tenantId, take);

  const result: RescoreResult = {
    considered: targets.length,
    scored: 0,
    unchanged: 0,
    skippedNoIcp: 0,
    failed: [],
  };
  const rulesCache = new Map<string, unknown | null>();
  const versionCache = new Map<string, string | null>();
  const versionFor = async (campaignId: string | null): Promise<string | null> => {
    const key = campaignId ?? "";
    if (!versionCache.has(key)) {
      versionCache.set(
        key,
        campaignId
          ? await resolveIcpVersionId(tenantId, campaignId)
          : await resolvePoolPreRankVersionId(tenantId),
      );
    }
    return versionCache.get(key) ?? null;
  };

  for (const target of targets) {
    try {
      const icpVersionId = await versionFor(target.campaignId);
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

      const scored = await scorePoolItem({
        tenantId,
        item: target.item,
        campaignId: target.campaignId,
        icpVersionId,
        rules: rules as never,
      });
      if (scored.inserted) result.scored += 1;
      else result.unchanged += 1;
    } catch (error) {
      result.failed.push({
        poolItemId: target.item.id,
        ...(target.campaignId ? { campaignId: target.campaignId } : {}),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
