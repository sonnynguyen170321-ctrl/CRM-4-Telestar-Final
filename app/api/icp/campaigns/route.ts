import { NextResponse } from "next/server";

import { requireIcpManager } from "@/app/api/icp/manager";
import { getVisibleCampaignIds } from "@/lib/auth";
import { requireTenantId } from "@/lib/api/tenant";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireIcpManager();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const visibleCampaignIds = await getVisibleCampaignIds(user);
  const campaigns = await prisma.campaign.findMany({
    where: {
      tenantId,
      ...(visibleCampaignIds === null
        ? {}
        : { id: { in: visibleCampaignIds } }),
    },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      status: true,
      icpVersionId: true,
      client: { select: { name: true } },
      icpVersion: {
        select: {
          id: true,
          versionNumber: true,
          status: true,
          icpProfile: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({ campaigns });
}
