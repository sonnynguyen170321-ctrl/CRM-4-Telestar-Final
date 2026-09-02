"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/server/prisma";
import {
  archiveCampaign,
  deleteCampaign,
  duplicateCampaign,
  renameCampaign,
} from "@/lib/v2/outreach/campaigns/campaignLifecycle";
import { requirePermission } from "@/lib/v2/tenant";

// Campaign lifecycle actions (rename / duplicate / archive / soft-delete). Gated on
// outreach.admin like the other campaign mutations; the lifecycle lib enforces status
// rules + tenant scope + audit. Called from client components (RowMenu/ConfirmDialog),
// so each returns a structured result instead of redirecting.

function field(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

const CAMPAIGNS_PATH = "/v2/outreach/campaigns";

export async function renameCampaignAction(formData: FormData) {
  const ctx = await requirePermission("outreach.admin");
  const result = await renameCampaign(prisma, { organizationId: ctx.organizationId, actorUserId: ctx.userId }, {
    campaignId: field(formData, "campaignId"),
    name: field(formData, "name"),
  });
  revalidatePath(CAMPAIGNS_PATH);
  return result;
}

export async function duplicateCampaignAction(formData: FormData) {
  const ctx = await requirePermission("outreach.admin");
  const result = await duplicateCampaign(prisma, { organizationId: ctx.organizationId, actorUserId: ctx.userId }, {
    campaignId: field(formData, "campaignId"),
  });
  revalidatePath(CAMPAIGNS_PATH);
  return result;
}

export async function archiveCampaignAction(formData: FormData) {
  const ctx = await requirePermission("outreach.admin");
  const result = await archiveCampaign(prisma, { organizationId: ctx.organizationId, actorUserId: ctx.userId }, {
    campaignId: field(formData, "campaignId"),
  });
  revalidatePath(CAMPAIGNS_PATH);
  return result;
}

export async function deleteCampaignAction(formData: FormData) {
  const ctx = await requirePermission("outreach.admin");
  const result = await deleteCampaign(prisma, { organizationId: ctx.organizationId, actorUserId: ctx.userId }, {
    campaignId: field(formData, "campaignId"),
  });
  revalidatePath(CAMPAIGNS_PATH);
  return result;
}
