import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/server/prisma";
import { requireTenantContext } from "@/lib/v2/tenant/requireTenantContext";

export default async function ProjectCompatibilityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const context = await requireTenantContext();
  const { projectId } = await params;
  const project = await prisma.v2Project.findFirst({
    where: { id: projectId, organizationId: context.organizationId, status: "ACTIVE" },
    select: { id: true, clientAccountId: true },
  });
  if (!project) notFound();
  redirect(`/v2/workspace/accounts?view=projects&accountId=${project.clientAccountId}&projectId=${project.id}`);
}
