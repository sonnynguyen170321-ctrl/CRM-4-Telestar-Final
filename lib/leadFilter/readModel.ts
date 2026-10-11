import type { Prisma } from "@prisma/client";
import { presentScoreExplanation } from "@telestar/core-scoring/scoreExplanation";

import type { SessionUser } from "@/lib/auth";
import { getVisibleCampaignIds } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  classifyCampaignProspect,
  type LeadFilterVerdict,
} from "@/lib/leadFilter/classification";
import { RETIRED_QUALIFICATIONS } from "@/lib/leadgen/poolItemState";

type ResolvedIcpVersion = { id: string; versionNumber: number; icpProfile: { name: string } };

/**
 * The ICP each campaign scores against TODAY, in two queries: its profile's newest published version,
 * or (legacy, no profile) its pinned version while still published. Mirrors `resolveCampaignIcp`
 * (lib/leadgen/scorePoolItem.ts) for a list; the stale pin is never treated as current.
 */
async function currentIcpVersions(
  tenantId: string,
  campaigns: Array<{ id: string; icpProfileId: string | null; icpVersionId: string | null }>,
): Promise<Map<string, ResolvedIcpVersion | null>> {
  const profileIds = [...new Set(campaigns.map((c) => c.icpProfileId).filter((id): id is string => Boolean(id)))];
  const pinIds = campaigns.filter((c) => !c.icpProfileId && c.icpVersionId).map((c) => c.icpVersionId as string);
  const select = { id: true, versionNumber: true, icpProfileId: true, icpProfile: { select: { name: true } } } as const;
  const [profileVersions, pins] = await Promise.all([
    profileIds.length
      ? prisma.icpVersion.findMany({ where: { tenantId, icpProfileId: { in: profileIds }, status: "published" }, orderBy: { versionNumber: "desc" }, select })
      : [],
    pinIds.length ? prisma.icpVersion.findMany({ where: { tenantId, id: { in: pinIds }, status: "published" }, select }) : [],
  ]);
  const newestByProfile = new Map<string, ResolvedIcpVersion>();
  for (const v of profileVersions) if (!newestByProfile.has(v.icpProfileId)) newestByProfile.set(v.icpProfileId, v);
  const pinById = new Map(pins.map((v) => [v.id, v]));
  return new Map(
    campaigns.map((c) => [
      c.id,
      c.icpProfileId ? (newestByProfile.get(c.icpProfileId) ?? null) : c.icpVersionId ? (pinById.get(c.icpVersionId) ?? null) : null,
    ]),
  );
}

export class LeadFilterCampaignUnavailableError extends Error {
  constructor() {
    super("lead_filter_campaign_unavailable");
    this.name = "LeadFilterCampaignUnavailableError";
  }
}

export type LeadFilterQuery = {
  campaignId?: string;
  verdict?: LeadFilterVerdict | "all";
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listLeadFilter(
  actor: SessionUser,
  tenantId: string,
  query: LeadFilterQuery,
) {
  if (actor.tenantId !== tenantId) throw new LeadFilterCampaignUnavailableError();

  const visibleIds = await getVisibleCampaignIds(actor);
  const campaignWhere: Prisma.CampaignWhereInput = {
    tenantId,
    status: "active",
    ...(visibleIds === null ? {} : { id: { in: visibleIds } }),
  };
  const campaignRows = await prisma.campaign.findMany({
    where: campaignWhere,
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      client: { select: { name: true } },
      icpProfileId: true,
      icpVersionId: true,
    },
  });
  const currentByCampaign = await currentIcpVersions(tenantId, campaignRows);
  const campaigns = campaignRows.map(({ icpProfileId: _p, icpVersionId: _v, ...campaign }) => ({
    ...campaign,
    icpVersion: currentByCampaign.get(campaign.id) ?? null,
  }));

  const campaignId = query.campaignId ?? campaigns[0]?.id;
  if (!campaignId) {
    return {
      campaigns,
      selectedCampaign: null,
      counts: { total: 0, qualified: 0, needs_review: 0, unqualified: 0, not_scored: 0 },
      items: [],
      page: 1,
      pageSize: 50,
      totalPages: 0,
    };
  }
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
  if (!selectedCampaign) throw new LeadFilterCampaignUnavailableError();

  const currentIcpVersionId = selectedCampaign.icpVersion?.id ?? null;
  const search = query.search?.trim();
  // A prospect retired at the pool level is not pipeline, whatever its CampaignProspect row says.
  // `qualifyPoolItems` / `markDuplicate` write only to LeadPoolItem, so the membership row is
  // left `ready` and this filter — which read CampaignProspect.status alone — kept offering
  // records a manager had just retired. lib/leadgen/poolItemState.ts measured the same class on
  // production: six duplicates still shown as workable, one of them a closed win. Same list.
  const livePoolItem: Prisma.LeadPoolItemWhereInput = {
    status: { notIn: ["archived", "disqualified"] },
    qualification: { notIn: [...RETIRED_QUALIFICATIONS] },
  };
  const baseWhere: Prisma.CampaignProspectWhereInput = {
    tenantId,
    campaignId,
    status: { not: "removed" },
    poolItem: {
      ...livePoolItem,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { company: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  };

  const categoryWhere = categoryFilters(currentIcpVersionId);
  const selectedVerdict = query.verdict && query.verdict !== "all" ? query.verdict : null;
  const filteredWhere: Prisma.CampaignProspectWhereInput = selectedVerdict
    ? { AND: [baseWhere, categoryWhere[selectedVerdict]] }
    : baseWhere;
  const pageSize = Math.min(100, Math.max(10, Math.trunc(query.pageSize ?? 50)));
  const requestedPage = Math.max(1, Math.trunc(query.page ?? 1));
  const totalPromise = prisma.campaignProspect.count({ where: baseWhere });

  const [total, qualified, needsReview, unqualified, notScored, filteredTotal] =
    await Promise.all([
      totalPromise,
      prisma.campaignProspect.count({ where: { AND: [baseWhere, categoryWhere.qualified] } }),
      prisma.campaignProspect.count({ where: { AND: [baseWhere, categoryWhere.needs_review] } }),
      prisma.campaignProspect.count({ where: { AND: [baseWhere, categoryWhere.unqualified] } }),
      prisma.campaignProspect.count({ where: { AND: [baseWhere, categoryWhere.not_scored] } }),
      selectedVerdict
        ? prisma.campaignProspect.count({ where: filteredWhere })
        : totalPromise,
    ]);
  const resolvedFilteredTotal = selectedVerdict ? filteredTotal : total;
  const totalPages = resolvedFilteredTotal === 0 ? 0 : Math.ceil(resolvedFilteredTotal / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);

  const rows = await prisma.campaignProspect.findMany({
    where: filteredWhere,
    orderBy: [{ addedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      status: true,
      addedAt: true,
      assessedIcpVersionId: true,
      poolItem: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          fullName: true,
          company: true,
          title: true,
          email: true,
          country: true,
          industry: true,
          sourceType: true,
        },
      },
      assessedIcpVersion: {
        select: { versionNumber: true, icpProfile: { select: { name: true } } },
      },
      latestAssessment: {
        select: {
          fitScore: true,
          confidenceScore: true,
          dataQualityScore: true,
          qualification: true,
          evidenceJson: true,
          createdAt: true,
        },
      },
      lead: { select: { id: true, engagementScore: true } },
    },
  });

  return {
    campaigns,
    selectedCampaign,
    counts: {
      total,
      qualified,
      needs_review: needsReview,
      unqualified,
      not_scored: notScored,
    },
    items: rows.map((row) => {
      const classification = classifyCampaignProspect({
        qualification: row.latestAssessment?.qualification ?? null,
        assessedIcpVersionId: row.assessedIcpVersionId,
        currentIcpVersionId,
      });
      return {
        id: row.id,
        status: row.status,
        addedAt: row.addedAt,
        prospect: {
          ...row.poolItem,
          name:
            row.poolItem.fullName ||
            [row.poolItem.firstName, row.poolItem.lastName].filter(Boolean).join(" ") ||
            "Unknown contact",
        },
        verdict: classification.verdict,
        verdictReason: classification.reason,
        fitScore: row.latestAssessment?.fitScore ?? null,
        confidenceScore: row.latestAssessment?.confidenceScore ?? null,
        dataQualityScore: row.latestAssessment?.dataQualityScore ?? null,
        assessedIcp: row.assessedIcpVersion
          ? {
              name: row.assessedIcpVersion.icpProfile.name,
              versionNumber: row.assessedIcpVersion.versionNumber,
            }
          : null,
        assessmentCreatedAt: row.latestAssessment?.createdAt ?? null,
        explanation: presentScoreExplanation({
          evidenceJson: row.latestAssessment?.evidenceJson,
        }),
        engagementScore: row.lead?.engagementScore ?? null,
        leadId: row.lead?.id ?? null,
      };
    }),
    page,
    pageSize,
    totalPages,
    filteredTotal: resolvedFilteredTotal,
  };
}

function categoryFilters(currentIcpVersionId: string | null): Record<LeadFilterVerdict, Prisma.CampaignProspectWhereInput> {
  const scored: Prisma.CampaignProspectWhereInput = {
    latestAssessmentId: { not: null },
    assessedIcpVersionId: { not: null },
  };
  const notScored: Prisma.CampaignProspectWhereInput = {
    OR: [{ latestAssessmentId: null }, { assessedIcpVersionId: null }],
  };
  if (!currentIcpVersionId) {
    return {
      qualified: { id: "__never__" },
      unqualified: { id: "__never__" },
      needs_review: scored,
      not_scored: notScored,
    };
  }
  return {
    qualified: {
      assessedIcpVersionId: currentIcpVersionId,
      latestAssessment: { qualification: "qualified" },
    },
    unqualified: {
      assessedIcpVersionId: currentIcpVersionId,
      latestAssessment: { qualification: "unqualified" },
    },
    needs_review: {
      AND: [
        scored,
        {
          OR: [
            { assessedIcpVersionId: { not: currentIcpVersionId } },
            { latestAssessment: { qualification: "needs_review" } },
          ],
        },
      ],
    },
    not_scored: notScored,
  };
}
