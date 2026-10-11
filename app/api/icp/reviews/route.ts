import { NextRequest, NextResponse } from "next/server";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import { safeValidateIcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import { requireIcpStaff } from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { getVisibleCampaignIds } from "@/lib/auth";
import { reviewableSubmitterIds } from "@/lib/leadgen/icpAccess";
import { diffIcpRules } from "@/lib/leadgen/icpRuleDiff";
import { prisma } from "@/lib/prisma";

const MAX_REVIEWS = 50;

/**
 * Personal ICPs waiting for the caller's decision: a team lead sees their pod's submissions, a
 * library manager sees every one. Each carries a plain-language diff against the profile's current
 * published rules (the whole rule set when it is the first version) and the campaigns it would
 * score. `?countOnly=1` returns just the number, for the navigation badge.
 */
export async function GET(req: NextRequest) {
  const user = await requireIcpStaff();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const submitters = await reviewableSubmitterIds(user);
  const where = {
    tenantId,
    status: "pending_review" as const,
    ...(submitters === null ? {} : { submittedById: { in: submitters } }),
  };

  if (new URL(req.url).searchParams.get("countOnly") === "1") {
    const count = submitters !== null && submitters.length === 0 ? 0 : await prisma.icpVersion.count({ where });
    return NextResponse.json({ count });
  }
  if (submitters !== null && submitters.length === 0) {
    return NextResponse.json({ reviews: [], count: 0 });
  }

  const pending = await prisma.icpVersion.findMany({
    where,
    orderBy: { submittedAt: "asc" },
    take: MAX_REVIEWS,
    select: {
      id: true,
      versionNumber: true,
      rulesJson: true,
      submittedAt: true,
      icpProfileId: true,
      icpProfile: {
        select: {
          id: true,
          name: true,
          kind: true,
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      submittedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const visibleCampaigns = await getVisibleCampaignIds(user);
  const reviews = await Promise.all(
    pending.map(async (item) => {
      const [current, campaigns] = await Promise.all([
        prisma.icpVersion.findFirst({
          where: { tenantId, icpProfileId: item.icpProfileId, status: "published" },
          orderBy: { versionNumber: "desc" },
          select: { id: true, versionNumber: true, rulesJson: true },
        }),
        prisma.campaign.findMany({
          where: {
            tenantId,
            icpProfileId: item.icpProfileId,
            ...(visibleCampaigns === null ? {} : { id: { in: visibleCampaigns } }),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 20,
        }),
      ]);
      const next = safeValidateIcpVersionRulesV2(item.rulesJson);
      const before = current ? safeValidateIcpVersionRulesV2(current.rulesJson) : null;
      const changes = next.success
        ? diffIcpRules(
            before?.success ? (before.data as IcpVersionRulesV2) : null,
            next.data as IcpVersionRulesV2,
          )
        : [];
      return {
        id: item.id,
        versionNumber: item.versionNumber,
        submittedAt: item.submittedAt,
        profile: item.icpProfile,
        submittedBy: item.submittedBy,
        currentPublishedVersion: current ? current.versionNumber : null,
        changes,
        rulesJson: item.rulesJson,
        campaigns,
      };
    }),
  );

  return NextResponse.json({ reviews, count: reviews.length });
}
