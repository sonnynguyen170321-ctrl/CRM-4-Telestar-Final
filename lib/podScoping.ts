/**
 * Pure pod-scoping core (SKILL.md §17), unit-testable without a DB or auth.
 * Returns the user IDs whose data the viewer may see, or `null` for
 * unrestricted (director). Walks the `managerId` chain:
 *   director → everyone · floor_manager → their TLs + those TLs' reports
 *   team_lead/leadgen → direct reports + self · sdr → self only
 */

export type OrgUser = { id: string; role: string; managerId: string | null };

export function computeVisibleUserIds(
  allUsers: OrgUser[],
  viewer: Pick<OrgUser, 'id' | 'role'>
): string[] | null {
  if (viewer.role === 'director') return null;
  if (viewer.role === 'sdr') return [viewer.id];

  // BFS down the managerId tree from the viewer
  const visible = new Set<string>([viewer.id]);
  let frontier = [viewer.id];
  while (frontier.length > 0) {
    const next = allUsers
      .filter((u) => u.managerId !== null && frontier.includes(u.managerId) && !visible.has(u.id))
      .map((u) => u.id);
    next.forEach((uid) => visible.add(uid));
    frontier = next;
  }
  return [...visible];
}

/**
 * Whether setting `userId`'s manager to `newManagerId` would produce a cycle in
 * the reporting chain. Walks UP from the proposed manager looking for `userId`.
 *
 * A cycle is unrecoverable through the UI — `computeVisibleUserIds` would loop
 * or silently truncate, and the user would vanish from every manager's scope.
 * Pure and in-memory: the caller already needs one `user.findMany` for the org,
 * so this costs no extra round-trips.
 */
export function wouldCreateManagerCycle(
  allUsers: OrgUser[],
  userId: string,
  newManagerId: string | null
): boolean {
  if (newManagerId === null) return false; // orphaning cannot cycle
  if (newManagerId === userId) return true; // self-manager

  const byId = new Map(allUsers.map((u) => [u.id, u]));
  const seen = new Set<string>();
  let cursor: string | null = newManagerId;

  while (cursor) {
    if (cursor === userId) return true;
    if (seen.has(cursor)) return true; // pre-existing corrupt cycle — refuse to add to it
    seen.add(cursor);
    cursor = byId.get(cursor)?.managerId ?? null;
  }
  return false;
}
