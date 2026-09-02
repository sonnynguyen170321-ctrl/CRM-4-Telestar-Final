"use server";

import { requireTenantContext } from "@/lib/v2/tenant/requireTenantContext";
import { prisma } from "@/lib/server/prisma";
import { revalidatePath } from "next/cache";

export async function updateProjectOwner(projectId: string, ownerUserId: string | null) {
  const context = await requireTenantContext();

  await prisma.v2Project.update({
    where: {
      id: projectId,
      organizationId: context.organizationId,
    },
    data: {
      ownerUserId,
    },
  });

  revalidatePath("/v2/workspace/accounts");
}

export async function addProjectTeamMember(projectId: string, userId: string) {
  const context = await requireTenantContext();
  // Invariant 5: the project must belong to the caller's org before we attach a member -
  // projectId comes from the client and must not reach another org's project.
  await assertProjectInOrg(projectId, context.organizationId);

  // Upsert to ensure no duplicates
  await prisma.v2ProjectTeamMember.upsert({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
    update: {},
    create: {
      projectId,
      userId,
      organizationId: context.organizationId,
    },
  });

  revalidatePath("/v2/workspace/accounts");
}

export async function removeProjectTeamMember(projectId: string, userId: string) {
  const context = await requireTenantContext();

  // Invariant 5: deleteMany DOES accept arbitrary filters, so we scope by organizationId -
  // a member can only be removed from a project inside the caller's own organization.
  await prisma.v2ProjectTeamMember.deleteMany({
    where: {
      projectId,
      userId,
      organizationId: context.organizationId,
    },
  });

  revalidatePath("/v2/workspace/accounts");
}

async function assertProjectInOrg(projectId: string, organizationId: string) {
  const project = await prisma.v2Project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true },
  });
  if (!project) throw new Error("Project not found in this organization.");
}
