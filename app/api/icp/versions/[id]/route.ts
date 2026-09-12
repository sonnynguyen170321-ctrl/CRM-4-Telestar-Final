import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  icpAuthoringErrorResponse,
  requireIcpManager,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { saveIcpDraft } from "@/lib/leadgen/icpAuthoring";

const saveDraftSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime(),
    rulesJson: z.unknown(),
    acknowledgeSimplification: z.boolean().optional(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireIcpManager();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = saveDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ICP draft", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const version = await saveIcpDraft({
      tenantId,
      versionId: id,
      ...parsed.data,
    });
    return NextResponse.json({ version });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
