import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireIcpManager, icpAuthoringErrorResponse } from "@/app/api/icp/manager";
import { canAccessPool } from "@/app/api/leadgen-pool/guard";
import { requireTenantId } from "@/lib/api/tenant";
import { requireAuth } from "@/lib/auth";
import { cloneIcpVersionAsDraft } from "@/lib/leadgen/icpAuthoring";
import { prisma } from "@/lib/prisma";
import { canUseResearch } from "@/lib/research/access";

const cloneSchema = z
  .object({
    sourceVersionId: z.string().min(1),
    acknowledgeSimplification: z.boolean().optional(),
  })
  .strict();

// Published versions remain the stable picker contract used by Research.
export async function GET() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  // Interactive pool users retain the existing picker contract. API keys never
  // inherit that role-only shortcut: strategy data requires an explicit
  // research scope as well as an eligible manager role.
  const canReadPublishedIcp = user.apiKey
    ? canUseResearch(user, "read")
    : canAccessPool(user.role) || canUseResearch(user, "read");
  if (!canReadPublishedIcp) {
    return NextResponse.json(
      { error: "Forbidden: published ICP read permission required" },
      { status: 403 },
    );
  }
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const versions = await prisma.icpVersion.findMany({
    where: { tenantId, status: "published" },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      versionNumber: true,
      status: true,
      publishedAt: true,
      createdAt: true,
      icpProfile: { select: { id: true, name: true, isDefault: true } },
    },
  });

  return NextResponse.json({ versions });
}

// A published version is immutable. Editing always starts by cloning it into one draft.
export async function POST(req: NextRequest) {
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
  const parsed = cloneSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid clone request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const version = await cloneIcpVersionAsDraft({
      tenantId,
      sourceVersionId: parsed.data.sourceVersionId,
      acknowledgeSimplification: parsed.data.acknowledgeSimplification,
    });
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
