import { NextResponse } from "next/server";

import { requireIcpManager } from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/**
 * Make this ICP profile the tenant default.
 *
 * The default scores every lead whose campaign has no ICP of its own (`resolveIcpVersionId`). It
 * could only be set when the first profile was created, so a tenant whose first profile was a test
 * ("Telestar") scored unassigned leads against it forever, while the real ICP sat unused next to it.
 *
 * One default per tenant, moved in a single transaction: the old default is cleared and the new one
 * set together, so no read in between can see two or none. A profile with no published version is
 * refused — a default that scores nothing would turn every unassigned lead NOT SCORED.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireIcpManager();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id } = await params;
  const profile = await prisma.icpProfile.findFirst({
    where: { id, tenantId },
    select: { id: true, name: true, isDefault: true, versions: { where: { status: "published" }, select: { id: true }, take: 1 } },
  });
  if (!profile) return NextResponse.json({ error: "ICP profile not found" }, { status: 404 });
  if (profile.versions.length === 0) {
    return NextResponse.json(
      { error: "Publish a version of this ICP before making it the default" },
      { status: 409 },
    );
  }
  if (profile.isDefault) return NextResponse.json({ id: profile.id, isDefault: true });

  await prisma.$transaction([
    prisma.icpProfile.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } }),
    prisma.icpProfile.updateMany({ where: { id: profile.id, tenantId }, data: { isDefault: true } }),
  ]);
  await logAdminAudit({
    actorId: user.id,
    action: "admin.icp.set_default",
    tableName: "IcpProfile",
    recordId: profile.id,
    changedFields: { name: profile.name },
  });
  return NextResponse.json({ id: profile.id, isDefault: true });
}
