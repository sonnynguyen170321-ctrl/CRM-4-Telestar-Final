import type { SessionUser } from '@/lib/auth';

type Role = SessionUser['role'];

/**
 * Which roles may act as a manager for each role. Encodes the hierarchy from
 * `.claude/rules/project-context.md`: Director → Floor Manager → Team Lead → SDR,
 * with the leadgen branch (Leadgen Manager → Leadgen) hanging off the Director.
 *
 * Enforced on `PUT /api/users/[id]`. Without it an SDR could be made the manager
 * of a Floor Manager, which `computeVisibleUserIds` would then honour — handing
 * the SDR visibility over the whole floor.
 */
const ALLOWED_MANAGER_ROLES: Record<Role, readonly Role[]> = {
  sdr: ['team_lead', 'floor_manager', 'director'],
  team_lead: ['floor_manager', 'director'],
  floor_manager: ['director'],
  leadgen: ['leadgen_manager', 'director'],
  leadgen_manager: ['director'],
  director: [], // the top of the chain — manager must be null
};

export function isValidManagerRole(subjectRole: Role, managerRole: Role): boolean {
  return ALLOWED_MANAGER_ROLES[subjectRole].includes(managerRole);
}

/** Human-readable reason for a rejected manager assignment, for the 400 body. */
export function describeManagerRoleRule(subjectRole: Role): string {
  const allowed = ALLOWED_MANAGER_ROLES[subjectRole];
  if (allowed.length === 0) {
    return `A ${subjectRole} sits at the top of the reporting chain and cannot have a manager.`;
  }
  return `A ${subjectRole} may only report to: ${allowed.join(', ')}.`;
}

/**
 * Roles that can own SDR-side work (leads, tasks, meetings, opportunities).
 *
 * Leadgen roles are deliberately excluded as *transfer targets*: `getLeadWhereScope`
 * scopes leadgen users by campaign rather than by assignee, so a lead handed to a
 * leadgen user disappears from the user axis and nobody sees it in their queue.
 */
export const WORK_OWNER_ROLES: readonly Role[] = ['sdr', 'team_lead', 'floor_manager'];

export function canOwnSdrWork(role: Role): boolean {
  return WORK_OWNER_ROLES.includes(role);
}
