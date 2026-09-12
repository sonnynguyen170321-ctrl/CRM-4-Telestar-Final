import type { SessionUser } from "@/lib/auth";

const SCORING_MANAGER_ROLES: ReadonlyArray<SessionUser["role"]> = [
  "team_lead",
  "floor_manager",
  "director",
  "leadgen_manager",
];

export function canManageScoring(role: SessionUser["role"]): boolean {
  return SCORING_MANAGER_ROLES.includes(role);
}

/**
 * API keys are narrower than the user who created them. Interactive sessions keep
 * their role authority, while automation must explicitly opt into scoring writes.
 */
export function canManageScoringRequest(user: SessionUser): boolean {
  if (!canManageScoring(user.role)) return false;
  if (!user.apiKey) return true;
  return (
    user.apiKey.scopes.includes("scoring:write") ||
    user.apiKey.scopes.includes("*")
  );
}
