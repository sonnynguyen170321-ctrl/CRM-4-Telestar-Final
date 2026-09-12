import { NextRequest, NextResponse } from "next/server";
import { ICP_TEMPLATES_V2 } from "@telestar/core-scoring/rules/icpTemplatesV2";
import { z } from "zod";

import {
  icpAuthoringErrorResponse,
  requireIcpManager,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import {
  createIcpProfile,
  listIcpProfiles,
} from "@/lib/leadgen/icpAuthoring";

const createProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    templateId: z.string().trim().min(1).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  const user = await requireIcpManager();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const profiles = await listIcpProfiles(tenantId);
  return NextResponse.json({
    profiles,
    templates: ICP_TEMPLATES_V2.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
  });
}

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
  const parsed = createProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ICP profile", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await createIcpProfile({ tenantId, ...parsed.data });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
