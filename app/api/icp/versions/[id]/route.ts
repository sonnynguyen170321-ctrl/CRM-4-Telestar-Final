import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ICP_LIMITS,
  authorizeVersionEdit,
  icpAuthoringErrorResponse,
  icpRateLimit,
  readBoundedJson,
  requireIcpUser,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
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
  const user = await requireIcpUser();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const limited = await icpRateLimit(user, "save", ICP_LIMITS.save.limit, ICP_LIMITS.save.windowSeconds);
  if (limited) return limited;
  const read = await readBoundedJson(req);
  if (!read.ok) return read.response;
  const parsed = saveDraftSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ICP draft", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id } = await params;
  const allowed = await authorizeVersionEdit(user, tenantId, id);
  if (allowed instanceof NextResponse) return allowed;

  try {
    const version = await saveIcpDraft({
      tenantId,
      versionId: id,
      ...parsed.data,
    });
    // Which ICP changed and when; not the rules themselves (the version row holds them).
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.save_draft",
      tableName: "IcpVersion",
      recordId: id,
      changedFields: { profileId: allowed.icpProfileId, versionNumber: allowed.versionNumber },
    });
    return NextResponse.json({ version });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
