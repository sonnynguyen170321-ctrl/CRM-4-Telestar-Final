import { canAccessUser, getVisibleUserIds } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import {
  canManageScoring,
  hasScoringWriteScope,
  isLibraryIcpRole,
} from "@/lib/leads/scoringAccess";

/**
 * Who may do what to which ICP. One place, so the routes, the list that tells the UI which buttons
 * to show, and the tests all read the same rules.
 *
 *   library ICP   create / edit / publish / set template ........ director, floor manager, leadgen manager
 *   custom ICP    create ........................................ anyone, for a campaign they can see
 *                 edit a draft .................................. its owner (and the library roles)
 *                 Publish ....................................... owner only: team lead and up publish
 *                                                                  directly; everyone else SUBMITS for review
 *                 approve / reject .............................. a team lead whose pod includes the
 *                                                                  submitter, or a library role; never the submitter
 *                 attach to a campaign .......................... rep: a library ICP or their own; team lead and up:
 *                                                                  any ICP they can see. Never one in review.
 *
 * Every function here is false for an API key without `scoring:write`.
 */

export type IcpProfileRef = {
  kind: "library" | "custom";
  ownerUserId: string | null;
};

export type PublishMode = "publish" | "submit";

/** Team lead and up: they publish their own ICPs directly and may rescore. */
export function isScoringStaff(user: SessionUser): boolean {
  return canManageScoring(user.role) && hasScoringWriteScope(user);
}

export function canEditProfile(user: SessionUser, profile: IcpProfileRef): boolean {
  if (!hasScoringWriteScope(user)) return false;
  if (profile.kind === "library") return isLibraryIcpRole(user.role);
  return profile.ownerUserId === user.id || isLibraryIcpRole(user.role);
}

/** A library ICP is visible to everyone; a custom one to its owner, their chain, and the library roles. */
export async function canViewProfile(
  user: SessionUser,
  profile: IcpProfileRef,
): Promise<boolean> {
  if (profile.kind === "library") return true;
  if (profile.ownerUserId === user.id) return true;
  if (isLibraryIcpRole(user.role)) return true;
  if (!profile.ownerUserId) return false;
  if (!canManageScoring(user.role)) return false;
  return canAccessUser(user, profile.ownerUserId);
}

/** What pressing Publish does for this person on this ICP, or null when they may not. */
export function publishModeFor(
  user: SessionUser,
  profile: IcpProfileRef,
): PublishMode | null {
  if (!hasScoringWriteScope(user)) return null;
  if (profile.kind === "library") {
    return isLibraryIcpRole(user.role) ? "publish" : null;
  }
  if (profile.ownerUserId !== user.id) return null;
  return canManageScoring(user.role) ? "publish" : "submit";
}

/** May this person point a campaign at this ICP? (The caller still checks the campaign is theirs.) */
export async function canAttachProfile(
  user: SessionUser,
  profile: IcpProfileRef,
): Promise<boolean> {
  if (!hasScoringWriteScope(user)) return false;
  if (profile.kind === "library") return true;
  if (profile.ownerUserId === user.id) return true;
  if (!canManageScoring(user.role)) return false;
  return canViewProfile(user, profile);
}

/**
 * May this person approve or reject a version submitted by `submittedById`?
 * Library roles: any. Team lead: only when the submitter is in their pod. Nobody reviews their own.
 */
export async function canReviewSubmission(
  user: SessionUser,
  submittedById: string | null,
): Promise<boolean> {
  if (!hasScoringWriteScope(user)) return false;
  if (submittedById && submittedById === user.id) return false;
  if (isLibraryIcpRole(user.role)) return true;
  if (user.role !== "team_lead") return false;
  if (!submittedById) return false;
  return canAccessUser(user, submittedById);
}

/** Owners whose custom ICPs this person may list: undefined = everyone's (library roles, director). */
export async function visibleCustomOwnerIds(user: SessionUser): Promise<string[] | undefined> {
  if (isLibraryIcpRole(user.role)) return undefined;
  if (!canManageScoring(user.role)) return [user.id];
  const visible = await getVisibleUserIds(user);
  return visible === null ? undefined : [...visible, user.id];
}

/** The user ids whose submissions this person reviews: null = all (library roles), [] = none. */
export async function reviewableSubmitterIds(
  user: SessionUser,
): Promise<string[] | null> {
  if (!hasScoringWriteScope(user)) return [];
  if (isLibraryIcpRole(user.role)) return null;
  if (user.role !== "team_lead") return [];
  const visible = await getVisibleUserIds(user);
  return (visible ?? []).filter((id) => id !== user.id);
}
