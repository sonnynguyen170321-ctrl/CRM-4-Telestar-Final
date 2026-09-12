import { NextRequest, NextResponse } from "next/server";

import { requireResearchManager } from "@/app/api/research/guard";
import { requireTenantId } from "@/lib/api/tenant";
import {
  LeadFilterCampaignUnavailableError,
  listLeadFilter,
} from "@/lib/leadFilter/readModel";
import type { LeadFilterVerdict } from "@/lib/leadFilter/classification";

const verdicts = new Set<LeadFilterVerdict>([
  "qualified",
  "needs_review",
  "unqualified",
  "not_scored",
]);

export async function GET(request: NextRequest) {
  const user = await requireResearchManager();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const params = request.nextUrl.searchParams;
  const verdictParam = params.get("verdict");
  const verdict = verdictParam && verdicts.has(verdictParam as LeadFilterVerdict)
    ? (verdictParam as LeadFilterVerdict)
    : "all";

  try {
    return NextResponse.json(
      await listLeadFilter(user, tenantId, {
        campaignId: params.get("campaignId") ?? undefined,
        verdict,
        search: params.get("search") ?? undefined,
        page: numberParam(params.get("page")),
        pageSize: numberParam(params.get("pageSize")),
      }),
    );
  } catch (error) {
    if (error instanceof LeadFilterCampaignUnavailableError) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    throw error;
  }
}

function numberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
