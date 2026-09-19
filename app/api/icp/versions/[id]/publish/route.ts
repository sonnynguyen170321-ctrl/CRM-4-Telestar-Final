import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  icpAuthoringErrorResponse,
  requireIcpManager,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
import { publishIcpDraft } from "@/lib/leadgen/icpAuthoring";

const publishSchema = z
  .object({ expectedUpdatedAt: z.string().datetime() })
  .strict();

export async function POST(
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
  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid publish request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const version = await publishIcpDraft({
      tenantId,
      versionId: id,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    });
    // Publishing is the moment an ICP starts scoring real prospects — the action a reviewer
    // of the Audit Log actually wants to find.
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.publish",
      tableName: "IcpVersion",
      recordId: id,
    });
    return NextResponse.json({ version });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
