import "server-only";

import type { V2MembershipRole } from "@/app/generated/prisma/client";

import type {
  V2TenantContext,
  V2TenantPermission,
} from "./types";
import { V2TenantError } from "./types";

export const V2_PERMISSION_ROLE_POLICY: Record<
  V2TenantPermission,
  V2MembershipRole[]
> = {
  "crm.read": ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR", "VIEWER"],
  // SDR is the real reviewer + operator: the rep scores, reviews, qualifies, and uploads
  // their own activity recaps. So the day-to-day loop (score / workflow / review / upload)
  // is self-serve for SDR + TEAM_LEAD. Org-shaping powers (lead.assign, outreach.admin,
  // ai.admin) stay manager/admin-only.
  "score.enqueue": ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR"],
  "workflow.update": ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR"],
  // Lead ownership assignment (M1): managers/leads route leads to SDRs. Distinct
  // from workflow.update so ownership policy can diverge from status edits later.
  "lead.assign": ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD"],
  "manager_review.decide": ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR"],
  "ingestion.apply": ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR"],
  "product_tree.write": ["OWNER", "ADMIN", "MANAGER"],
  "outreach.admin": ["OWNER", "ADMIN"],
  // Feedback capture is a learning signal anyone working leads can submit; the
  // `approvedForLearning` flag (manager-gated) controls tuning eligibility.
  "feedback.write": ["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR"],
  // Only managers gate which captured examples become tuning-eligible (M4).
  "feedback.approve": ["OWNER", "ADMIN", "MANAGER"],
  // AI settings/providers/models/rate-limits are admin-only (governs spend + keys).
  "ai.admin": ["OWNER", "ADMIN"],
};

export function assertPermission(
  context: V2TenantContext,
  permission: V2TenantPermission
) {
  const allowedRoles = V2_PERMISSION_ROLE_POLICY[permission];

  if (!allowedRoles.includes(context.role)) {
    throw new V2TenantError(
      "FORBIDDEN",
      `Role ${context.role} is not allowed to perform ${permission}.`
    );
  }
}

export function hasPermission(
  role: V2MembershipRole,
  permission: V2TenantPermission
) {
  return V2_PERMISSION_ROLE_POLICY[permission].includes(role);
}
