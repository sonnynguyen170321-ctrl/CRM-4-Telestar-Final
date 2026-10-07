/**
 * The part of the admin console a team lead may open: the campaign list and a campaign's members
 * (owner, 2026-10-07: "why not use the existing campaign page"). Everything else under /admin stays
 * director and floor manager only. The APIs behind these pages scope a team lead to their pod's
 * campaigns themselves; this only decides which pages are served.
 *
 * Pure, so the edge proxy and the client layout share one answer.
 */
const TEAM_LEAD_ADMIN_PATHS = [/^\/admin\/campaigns\/?$/, /^\/admin\/campaigns\/[^/]+\/members\/?$/];

export const ADMIN_CONSOLE_ROLES: ReadonlySet<string> = new Set(['director', 'floor_manager']);

export function canOpenAdminPath(role: string | null | undefined, pathname: string): boolean {
  if (!role) return false;
  if (ADMIN_CONSOLE_ROLES.has(role)) return true;
  return role === 'team_lead' && TEAM_LEAD_ADMIN_PATHS.some((path) => path.test(pathname));
}
