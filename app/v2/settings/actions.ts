"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/v2/tenant";
import {
  createOrgUser,
  setMembershipRole,
  setMembershipStatus,
} from "@/lib/v2/tenant/manageUsers";

// Settings user-management actions. Session auth via requirePermission; the org-admin gate
// (OWNER/ADMIN) + all anti-lockout rules live in the manageUsers lib. Never trusts a client
// organizationId — it comes from the authenticated context.

function field(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

export async function createUserAction(formData: FormData) {
  const ctx = await requirePermission("crm.read");
  const result = await createOrgUser({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    name: field(formData, "name"),
    email: field(formData, "email"),
    role: field(formData, "role") || "SDR",
    tempPassword: field(formData, "tempPassword") || undefined,
  });
  revalidatePath("/v2/settings");
  return result;
}

export async function setUserStatusAction(formData: FormData) {
  const ctx = await requirePermission("crm.read");
  const status = field(formData, "status");
  const result = await setMembershipStatus({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    targetUserId: field(formData, "userId"),
    status: status === "DISABLED" ? "DISABLED" : "ACTIVE",
  });
  revalidatePath("/v2/settings");
  return result;
}

export async function setUserRoleAction(formData: FormData) {
  const ctx = await requirePermission("crm.read");
  const result = await setMembershipRole({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    targetUserId: field(formData, "userId"),
    role: field(formData, "role"),
  });
  revalidatePath("/v2/settings");
  return result;
}
