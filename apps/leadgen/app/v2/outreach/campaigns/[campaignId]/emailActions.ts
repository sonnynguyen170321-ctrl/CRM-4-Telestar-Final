"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/v2/tenant";

export async function skipCampaignEmailAction(campaignId: string, emailId: string) {
  const context = await requirePermission("outreach.admin");

  // Stabilization path: never fake-queue a send. Mark this row as intentionally skipped.
  await prisma.v2OutreachMessage.updateMany({
    where: {
      id: emailId,
      organizationId: context.organizationId,
    },
    data: {
      status: "FAILED",
      errorMessage: "Skipped by user",
      failedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  revalidatePath(campaignEmailHref(campaignId));
}

export async function deleteCampaignEmailAction(campaignId: string, emailId: string) {
  const context = await requirePermission("outreach.admin");

  await prisma.v2OutreachMessage.updateMany({
    where: {
      id: emailId,
      organizationId: context.organizationId,
    },
    data: {
      deletedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  revalidatePath(campaignEmailHref(campaignId));
}

function campaignEmailHref(campaignId: string): string {
  return `/v2/outreach/campaigns/${encodeURIComponent(campaignId)}?tab=emails`;
}
