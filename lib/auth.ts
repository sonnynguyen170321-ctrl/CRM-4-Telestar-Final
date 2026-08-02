import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeVisibleUserIds } from '@/lib/podScoping';

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'director' | 'floor_manager' | 'team_lead' | 'sdr' | 'leadgen_manager' | 'leadgen';
  isManager?: boolean;
  tenantId?: string;
};

/** True for roles on the leadgen branch (manager or member). */
export function isLeadgenUser(role: SessionUser['role']): boolean {
  return role === 'leadgen_manager' || role === 'leadgen';
}

/** True for roles that can act as a leadgen manager (manage the pool/team). */
export function isLeadgenManager(role: SessionUser['role']): boolean {
  return role === 'leadgen_manager' || role === 'director' || role === 'floor_manager';
}

/** Get the authenticated session user from a Server Component or API route. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  return session.user as SessionUser;
}

/** Require authentication in an API route handler. Returns user or 401 response. */
export async function requireAuth(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return user;
}

/** Require a specific role (or above) in an API route handler. */
export async function requireRole(
  minRole: SessionUser['role']
): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const hierarchy: SessionUser['role'][] = ['sdr', 'leadgen', 'leadgen_manager', 'team_lead', 'floor_manager', 'director'];
  const userLevel = hierarchy.indexOf(user.role);
  const requiredLevel = hierarchy.indexOf(minRole);

  if (userLevel < requiredLevel) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return user;
}

/** Require a manager role (director, floor_manager, team_lead, or any user with isManager=true) in an API route. */
export async function requireManager(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (user.role !== 'director' && user.role !== 'floor_manager' && user.role !== 'team_lead' && !user.isManager) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return user;
}

export { computeVisibleUserIds };

/**
 * The user IDs this viewer may see, or `null` for unrestricted.
 * Use in queries as: `userId: { in: ids }` / `assignedToId: { in: ids }`.
 */
const visibleUserCache = new Map<string, { result: string[] | null; ts: number }>();
const VISIBLE_USER_CACHE_TTL = 60_000;

export async function getVisibleUserIds(user: SessionUser): Promise<string[] | null> {
  if (user.role === 'director') return null;
  if (user.role === 'sdr') return [user.id];

  const cached = visibleUserCache.get(user.id);
  if (cached && Date.now() - cached.ts < VISIBLE_USER_CACHE_TTL) {
    return cached.result;
  }

  const allUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, role: true, managerId: true },
  });
  const result = computeVisibleUserIds(allUsers, user);
  visibleUserCache.set(user.id, { result, ts: Date.now() });
  return result;
}

export function clearVisibleUserCache(userId?: string) {
  if (userId) {
    visibleUserCache.delete(userId);
  } else {
    visibleUserCache.clear();
  }
}

/** True when the viewer is allowed to see/modify data owned by `ownerId`. */
export async function canAccessUser(viewer: SessionUser, ownerId: string): Promise<boolean> {
  if (viewer.id === ownerId) return true;
  const visible = await getVisibleUserIds(viewer);
  return visible === null || visible.includes(ownerId);
}

/** Build a Prisma `where` clause that scopes leads/tasks to the user's role. */
export function buildRoleScope(user: SessionUser) {
  switch (user.role) {
    case 'director':
    case 'floor_manager':
      return {}; // sees all
    case 'team_lead':
    case 'leadgen':
    case 'leadgen_manager':
      return {}; // pod scoping (managerId) applied in each query — not handled here
    case 'sdr':
    default:
      return { assignedToId: user.id };
  }
}

/** Roles allowed to import and export leads. Team Lead is intentionally excluded. */
export function canImportExport(role: SessionUser['role']): boolean {
  return role === 'director' || role === 'floor_manager' || role === 'leadgen_manager' || role === 'leadgen' || role === 'sdr';
}

/**
 * Leadgen scoping by explicit role.
 * - `leadgen_manager` (and director/floor_manager) → manager (sees the whole pool).
 * - `leadgen` → member, scoped to the accounts/campaigns assigned via CampaignSdr.
 * - any other role → none.
 */
export async function getLeadgenScope(
  user: SessionUser
): Promise<{ kind: 'manager' } | { kind: 'member'; campaignIds: string[] } | { kind: 'none' }> {
  if (user.role === 'director' || user.role === 'floor_manager' || user.role === 'leadgen_manager') {
    return { kind: 'manager' };
  }
  if (user.role === 'leadgen') {
    const assignments = await prisma.campaignSdr.findMany({
      where: { userId: user.id },
      select: { campaignId: true },
    });
    return { kind: 'member', campaignIds: assignments.map((a) => a.campaignId) };
  }
  return { kind: 'none' };
}

/**
 * The campaign IDs (accounts) this viewer may see, or `null` for unrestricted.
 * Account axis (used for the Accounts views). Director / leadgen-manager → null.
 * FM / Team Lead / SDR → campaigns any of their visible users are assigned to.
 * Leadgen member → only their directly-assigned campaigns.
 */
export async function getVisibleCampaignIds(user: SessionUser): Promise<string[] | null> {
  if (user.role === 'director') return null;
  if (isLeadgenUser(user.role)) {
    const scope = await getLeadgenScope(user);
    if (scope.kind === 'manager') return null;
    if (scope.kind === 'member') return scope.campaignIds;
    // 'none' — not a leadgen role; fall through to user-axis scoping
  }
  const visibleIds = await getVisibleUserIds(user);
  if (visibleIds === null) return null;
  const rows = await prisma.campaignSdr.findMany({
    where: { userId: { in: visibleIds } },
    select: { campaignId: true },
  });
  return [...new Set(rows.map((r) => r.campaignId))];
}

/**
 * Prisma `where` fragment scoping a lead query for this viewer.
 * Leadgen scopes by ACCOUNT (campaign); everyone else by assignee (user axis).
 *
 * Team Leads and Floor Managers get a UNION of the user axis (leads assigned to
 * their pod) AND the account axis (any lead in a campaign their team/floor is
 * assigned to) — so they can jump in and work any lead in their accounts to help
 * SDRs. Director sees all; SDR sees only their own.
 */
export async function getLeadWhereScope(user: SessionUser): Promise<Record<string, unknown>> {
  if (isLeadgenUser(user.role)) {
    const scope = await getLeadgenScope(user);
    if (scope.kind === 'manager') return {}; // all leads org-wide
    if (scope.kind === 'member') return { campaignId: { in: scope.campaignIds } }; // assigned accounts only
    // 'none' falls through to user-axis scoping below
  }
  const visibleIds = await getVisibleUserIds(user);
  if (visibleIds === null) return {}; // director — all leads

  if (user.role === 'team_lead' || user.role === 'floor_manager') {
    const campaignIds = await getVisibleCampaignIds(user);
    if (campaignIds === null) return {}; // safety; only director/leadgen-mgr return null
    return {
      OR: [
        { assignedToId: { in: visibleIds } },
        ...(campaignIds.length > 0 ? [{ campaignId: { in: campaignIds } }] : []),
      ],
    };
  }

  return { assignedToId: { in: visibleIds } };
}

/**
 * Roles whose lead access extends along the ACCOUNT axis (any lead in a campaign
 * they're assigned to), not just the user axis. Team Leads / Floor Managers jump
 * into their accounts to help; Director sees all; leadgen members work their
 * assigned accounts. **SDRs are intentionally excluded** — an SDR may only touch
 * their own leads, never a teammate's lead in a shared campaign.
 */
const ACCOUNT_AXIS_ROLES: ReadonlyArray<SessionUser['role']> = [
  'director',
  'floor_manager',
  'team_lead',
  'leadgen_manager',
  'leadgen',
];

/**
 * True when the viewer may see/modify a specific lead. User axis OR account axis:
 * the lead is assigned to someone the viewer manages (`canAccessUser`), OR — for
 * account-axis roles only — the lead's campaign is one the viewer's team/floor is
 * assigned to (`getVisibleCampaignIds`). Use in lead-owned write/read-guard paths
 * instead of `canAccessUser(viewer, lead.assignedToId)` so Team Leads / Floor
 * Managers can work any lead in their accounts (even unassigned or assigned to an
 * SDR), while SDRs stay restricted to their own leads.
 */
export async function canAccessLead(
  viewer: SessionUser,
  lead: { assignedToId: string | null; campaignId: string | null }
): Promise<boolean> {
  // User axis: only when the lead actually has an assignee. An UNASSIGNED lead is
  // not "owned by me" — it is reachable solely via the account axis below, so an
  // SDR can never touch an unassigned lead in a shared campaign.
  if (lead.assignedToId && (await canAccessUser(viewer, lead.assignedToId))) return true;
  // Account axis is a manager/leadgen privilege only — never widens SDR access.
  if (!ACCOUNT_AXIS_ROLES.includes(viewer.role)) return false;
  if (!lead.campaignId) return false;
  const campaignIds = await getVisibleCampaignIds(viewer);
  if (campaignIds === null) return true; // unrestricted (director / leadgen-manager)
  return campaignIds.includes(lead.campaignId);
}
