import type { Prisma } from "@prisma/client";
import { presentScoreExplanation } from "@telestar/core-scoring/scoreExplanation";

import type { SessionUser } from "@/lib/auth";
import { getVisibleCampaignIds } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  classifyCampaignProspect,
  type LeadFilterVerdict,
} from "@/lib/leadFilter/classification";

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
  const campaigns = await prisma.campaign.findMany({
    where: campaignWhere,
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      client: { select: { name: true } },
      icpVersion: {
        select: {
          id: true,
          versionNumber: true,
          icpProfile: { select: { name: true } },
        },
      },
    },
  });

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
  const baseWhere: Prisma.CampaignProspectWhereInput = {
    tenantId,
    campaignId,
    status: { not: "removed" },
    ...(search
      ? {
          poolItem: {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { company: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
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
