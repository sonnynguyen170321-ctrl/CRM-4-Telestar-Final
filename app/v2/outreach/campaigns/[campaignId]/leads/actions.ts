"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/v2/tenant";
import {
  pauseEnrollments,
  resumeEnrollments,
  removeEnrollments,
  type EnrollmentActionResult,
} from "@/lib/v2/outreach/campaigns/enrollmentActions";

// Per-lead campaign actions for the leads manager. Gated on outreach.admin (same as the
// campaign-wide lifecycle actions). Each revalidates the subpage so counts/status refresh.

async function run(
  campaignId: string,
  enrollmentIds: string[],
  fn: typeof pauseEnrollments
): Promise<EnrollmentActionResult> {
  const context = await requirePermission("outreach.admin");
  const result = await fn({
    organizationId: context.organizationId,
    campaignId,
    enrollmentIds,
    actorUserId: context.userId,
  });
  revalidatePath(`/v2/outreach/campaigns/${campaignId}/leads`);
  return result;
}

export async function pauseEnrollmentsAction(campaignId: string, enrollmentIds: string[]) {
  return run(campaignId, enrollmentIds, pauseEnrollments);
}

export async function resumeEnrollmentsAction(campaignId: string, enrollmentIds: string[]) {
  return run(campaignId, enrollmentIds, resumeEnrollments);
}

export async function removeEnrollmentsAction(campaignId: string, enrollmentIds: string[]) {
  return run(campaignId, enrollmentIds, removeEnrollments);
}
