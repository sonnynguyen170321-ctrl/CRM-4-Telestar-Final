"use server";

import { revalidatePath } from "next/cache";

import { disableSender, updateSenderDisplay } from "@/lib/v2/outreach/senders/manageSender";
import { requirePermission } from "@/lib/v2/tenant";

// Sender edit/disable actions for the client kebab. Gated outreach.admin; rules + audit in
// the manageSender lib.

function field(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

export async function updateSenderDisplayAction(formData: FormData) {
  const ctx = await requirePermission("outreach.admin");
  const result = await updateSenderDisplay(
    { organizationId: ctx.organizationId, actorUserId: ctx.userId },
    {
      senderId: field(formData, "senderId"),
      displayName: field(formData, "displayName"),
      fromName: field(formData, "fromName") || null,
    }
  );
  revalidatePath("/v2/outreach/senders");
  return result;
}

export async function disableSenderAction(formData: FormData) {
  const ctx = await requirePermission("outreach.admin");
  const result = await disableSender(
    { organizationId: ctx.organizationId, actorUserId: ctx.userId },
    { senderId: field(formData, "senderId") }
  );
  revalidatePath("/v2/outreach/senders");
  return result;
}
