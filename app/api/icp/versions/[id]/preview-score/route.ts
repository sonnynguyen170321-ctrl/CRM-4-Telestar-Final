import { NextRequest, NextResponse } from "next/server";

import { requireIcpManager } from "@/app/api/icp/manager";
import { safeValidateIcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import { requireTenantId } from "@/lib/api/tenant";
import { previewIcpRules } from "@/lib/leads/icpPreview";
import { prisma } from "@/lib/prisma";

/**
 * Score a sample of real leads against *unsaved* ICP rules, for the scoring editor's live preview.
 *
 * Read-only by construction: `previewIcpRules` writes nothing, so the editor can call this on every
 * change without leaving rows, audit entries or moved verdicts behind. The version in the path only
 * anchors which ICP profile's leads to sample, and must belong to the caller's tenant; the rules
 * come from the body and are validated by the same schema a save would use.
 *
 * Same gate as every ICP write — the four manager roles, and `scoring:write` for API keys — because
 * it reads verdicts across the tenant's leads, not only the caller's own.
 */
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

  const validated = safeValidateIcpVersionRulesV2((raw as { rulesJson?: unknown } | null)?.rulesJson);
  if (!validated.success) {
    return NextResponse.json(
      { error: "Rules are not valid yet", details: validated.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }

  const { id } = await params;
  const version = await prisma.icpVersion.findFirst({
    where: { id, tenantId },
    select: { icpProfileId: true },
  });
  if (!version) return NextResponse.json({ error: "ICP version not found" }, { status: 404 });

  try {
    const preview = await previewIcpRules({
      tenantId,
      icpProfileId: version.icpProfileId,
      rules: validated.data,
    });
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[api/icp/preview-score] failed", { tenantId, versionId: id, error });
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
