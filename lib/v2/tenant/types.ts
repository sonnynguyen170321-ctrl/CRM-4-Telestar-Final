import type { V2MembershipRole } from "@/app/generated/prisma/client";

export type V2TenantContext = {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: V2MembershipRole;
  emailNormalized: string;
  userName: string | null;
  organizationName: string;
};

export type V2TenantPermission =
  | "crm.read"
  | "score.enqueue"
  | "workflow.update"
  | "lead.assign"
  | "manager_review.decide"
  | "ingestion.apply"
  | "product_tree.write"
  | "outreach.admin"
  | "feedback.write"
  | "feedback.approve"
  | "ai.admin";

export type V2TenantErrorCode =
  | "UNAUTHENTICATED"
  | "APP_USER_NOT_FOUND"
  | "APP_USER_INACTIVE"
  | "NO_ACTIVE_MEMBERSHIP"
  | "MULTIPLE_MEMBERSHIPS_REQUIRE_SELECTOR"
  | "ORG_INACTIVE"
  | "FORBIDDEN";

export class V2TenantError extends Error {
  code: V2TenantErrorCode;

  constructor(code: V2TenantErrorCode, message: string) {
    super(message);
    this.name = "V2TenantError";
    this.code = code;
  }
}
