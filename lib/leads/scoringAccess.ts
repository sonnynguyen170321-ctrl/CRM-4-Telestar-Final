import type { SessionUser } from "@/lib/auth";

/**
 * Who may do what with scoring, in two tiers.
 *
 * "Scoring staff" (team lead and up) rescore campaigns, read tenant scoring data and review rep-made
 * ICPs. They are NOT the people who author the shared library: since 2026-10-11 the library (the
 * ICPs every campaign can share) is edited, published and made the template only by director,
 * floor manager and leadgen manager. A team lead used to edit it tenant-wide; they now author a
 * personal ICP like anyone else and review the ones their pod submits.
 */
const SCORING_MANAGER_ROLES: ReadonlyArray<SessionUser["role"]> = [
  "team_lead",
  "floor_manager",
  "director",
  "leadgen_manager",
];

const LIBRARY_ICP_ROLES: ReadonlyArray<SessionUser["role"]> = [
  "floor_manager",
  "director",
  "leadgen_manager",
];

export function canManageScoring(role: SessionUser["role"]): boolean {
  return SCORING_MANAGER_ROLES.includes(role);
}

/** Roles that author the shared ICP library and decide which ICP is the template. */
export function isLibraryIcpRole(role: SessionUser["role"]): boolean {
  return LIBRARY_ICP_ROLES.includes(role);
}

/**
 * API keys are narrower than the user who created them. Interactive sessions keep
 * their role authority, while automation must explicitly opt into scoring writes.
 */
export function hasScoringWriteScope(user: SessionUser): boolean {
  if (!user.apiKey) return true;
  return (
    user.apiKey.scopes.includes("scoring:write") ||
    user.apiKey.scopes.includes("*")
  );
}

export function canManageScoringRequest(user: SessionUser): boolean {
  if (!canManageScoring(user.role)) return false;
  return hasScoringWriteScope(user);
}

/** Library ICP create / edit / publish / set-template. */
export function canManageLibraryIcp(user: SessionUser): boolean {
  return isLibraryIcpRole(user.role) && hasScoringWriteScope(user);
}
