import type { SessionUser } from "@/lib/auth";

export type ResearchAction = "read" | "run" | "promote" | "manage";

const RESEARCH_OPERATOR_ROLES: ReadonlyArray<SessionUser["role"]> = [
  "sdr",
  "director",
  "floor_manager",
  "team_lead",
  "leadgen_manager",
];

const RESEARCH_MANAGER_ROLES: ReadonlyArray<SessionUser["role"]> = [
  "director",
  "floor_manager",
  "leadgen_manager",
];

export function canUseResearchRole(
  role: SessionUser["role"],
  action: ResearchAction,
): boolean {
  if (!RESEARCH_OPERATOR_ROLES.includes(role)) return false;
  return action !== "manage" || RESEARCH_MANAGER_ROLES.includes(role);
}

export function canUseResearch(
  user: SessionUser,
  action: ResearchAction,
): boolean {
  if (!canUseResearchRole(user.role, action)) return false;

  if (!user.apiKey) return true;
  const scopes = user.apiKey.scopes;
  if (scopes.includes("*")) return true;
  if (action === "read") {
    return scopes.includes("research:read") || scopes.includes("research:write");
  }
  return scopes.includes("research:write");
}

/**
 * The cap is an authorization boundary, not a form hint. Callers must reject a
 * requested limit above it instead of silently charging for more provider work.
 */
export function researchQueryLimitForRole(
  role: SessionUser["role"],
): number {
  return RESEARCH_MANAGER_ROLES.includes(role) ? 1000 : 100;
}

export function researchQueryOptionsForRole(
  role: SessionUser["role"],
): number[] {
  return researchQueryLimitForRole(role) > 100
    ? [50, 100, 200, 1000]
    : [50, 100];
}

export function validateResearchQueryLimit(
  role: SessionUser["role"],
  requested: number | undefined,
): { ok: true } | { ok: false; max: number } {
  const max = researchQueryLimitForRole(role);
  if (requested !== undefined && requested > max) {
    return { ok: false, max };
  }
  return { ok: true };
}
