"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/v2/tenant";
import { assignLead, type AssignLeadDb, type AssignLeadResult } from "@/lib/v2/crm/assignLead";

export async function assignOwnerAction(
  leadAssignmentId: string,
  ownerUserId: string | null
): Promise<AssignLeadResult> {
  const context = await requirePermission("lead.assign");
  const result = await assignLead(prisma as unknown as AssignLeadDb, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    leadAssignmentId,
    ownerUserId,
  });
  revalidatePath("/v2/crm/contacts");
  return result;
}

export type AssignOwnersResult = {
  requested: number;
  assigned: number;
  noChange: number;
  notFound: number;
  invalidAssignee: number;
};

export async function assignOwnersAction(
  leadAssignmentIds: string[],
  ownerUserId: string | null
): Promise<AssignOwnersResult> {
  const context = await requirePermission("lead.assign");
  const ids = Array.from(new Set(leadAssignmentIds.map((id) => id.trim()).filter(Boolean))).slice(0, 500);
  const result: AssignOwnersResult = {
    requested: ids.length,
    assigned: 0,
    noChange: 0,
    notFound: 0,
    invalidAssignee: 0,
  };

  for (const leadAssignmentId of ids) {
    const assigned = await assignLead(prisma as unknown as AssignLeadDb, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      leadAssignmentId,
      ownerUserId,
    });

    if (assigned.kind === "assigned") result.assigned += 1;
    else if (assigned.kind === "no_change") result.noChange += 1;
    else if (assigned.kind === "not_found") result.notFound += 1;
    else if (assigned.kind === "invalid_assignee") result.invalidAssignee += 1;
  }

  revalidatePath("/v2/crm/contacts");
  return result;
}

