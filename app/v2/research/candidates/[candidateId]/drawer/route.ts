import { NextResponse } from "next/server";

import { queryResearchCandidateDrawer } from "@/lib/v2/research/queryResearch";
import { requirePermission } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const ctx = await requirePermission("ingestion.apply");
  const { candidateId } = await params;
  const detail = await queryResearchCandidateDrawer(ctx.organizationId, candidateId);
  if (!detail) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  return NextResponse.json(detail);
}
