import type { V2TenantError, V2TenantErrorCode } from "./types";

export type TenantErrorMessage = {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  technicalCode: string;
};

const TENANT_ERROR_MESSAGES: Record<V2TenantErrorCode, TenantErrorMessage> = {
  UNAUTHENTICATED: {
    title: "Sign in required.",
    message: "Log in with your TeleStar email and password to access the V2 workspace.",
    actionLabel: "Go to login",
    actionHref: "/v2/login",
    technicalCode: "UNAUTHENTICATED",
  },
  APP_USER_NOT_FOUND: {
    title: "Your TeleStar V2 user has not been provisioned.",
    message: "Ask an admin to create or activate your V2 user account.",
    actionLabel: "Log out",
    actionHref: "/v2/logout",
    technicalCode: "APP_USER_NOT_FOUND",
  },
  APP_USER_INACTIVE: {
    title: "Your TeleStar V2 user is inactive.",
    message: "Ask an admin to reactivate your V2 user account.",
    actionLabel: "Log out",
    actionHref: "/v2/logout",
    technicalCode: "APP_USER_INACTIVE",
  },
  NO_ACTIVE_MEMBERSHIP: {
    title: "You do not have an active organization membership.",
    message: "Ask an admin to add you to an active TeleStar V2 organization.",
    actionLabel: "Log out",
    actionHref: "/v2/logout",
    technicalCode: "NO_ACTIVE_MEMBERSHIP",
  },
  MULTIPLE_MEMBERSHIPS_REQUIRE_SELECTOR: {
    title:
      "Your account has multiple organizations, but organization switching is not available yet.",
    message:
      "Ask an admin which organization should be active for this CRM workspace, or log out and wait for org switching support.",
    actionLabel: "Log out",
    actionHref: "/v2/logout",
    technicalCode: "MULTIPLE_MEMBERSHIPS_REQUIRE_SELECTOR",
  },
  ORG_INACTIVE: {
    title: "This organization is inactive.",
    message: "Ask an admin to reactivate the organization before using V2.",
    actionLabel: "Log out",
    actionHref: "/v2/logout",
    technicalCode: "ORG_INACTIVE",
  },
  FORBIDDEN: {
    title: "You do not have permission to view this workspace.",
    message: "Ask an admin to update your role if you need V2 CRM access.",
    actionLabel: "Log out",
    actionHref: "/v2/logout",
    technicalCode: "FORBIDDEN",
  },
};

export function getTenantErrorMessage(
  error: V2TenantError
): TenantErrorMessage {
  return TENANT_ERROR_MESSAGES[error.code];
}
