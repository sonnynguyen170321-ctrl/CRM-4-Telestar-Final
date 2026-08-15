import { cache } from 'react';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
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

const MANAGER_ROLES: readonly SessionUser['role'][] = ['director', 'floor_manager', 'team_lead'];

/** True for roles on the leadgen branch (manager or member). */
export function isLeadgenUser(role: SessionUser['role']): boolean {
  return role === 'leadgen_manager' || role === 'leadgen';
}

/** True for roles that can act as a leadgen manager (manage the pool/team). */
export function isLeadgenManager(role: SessionUser['role']): boolean {
  return role === 'leadgen_manager' || role === 'director' || role === 'floor_manager';
}

/**
 * The authenticated user, revalidated against the database.
 *
 * Sessions are stateless JWTs. The token is a claim about who the user *was* when it was
 * minted, not who they are now — a deactivated, demoted, tenant-moved or password-reset user
 * kept full access here until the token expired. Every protected request therefore re-reads
 * the row and rejects the token unless the user still exists, is still active, is still in the
 * same tenant, and still carries the same `authVersion`.
 *
 * **Authorization uses the database role, never the token's.** A director demoted to SDR keeps
 * `role: 'director'` in their cookie; honouring that is the whole bug this closes.
 *
 * Two implementation details that are load-bearing:
 *   - `cache()` scopes the extra query to one per request, matching `getTenantIdFromSession`.
 *   - The read runs inside a `tenantStorage` bypass. Without it the tenant extension in
 *     `lib/prisma.ts` would call `getTenantIdFromSession()`, which calls `auth()`, to resolve
 *     the scope for this very query.
 *
 * Returns `null` for every failure mode. Callers turn that into a bare 401 — deliberately not
 * saying whether the account was deactivated, demoted or the token simply aged out.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const token = session?.user as (SessionUser & { authVersion?: number }) | undefined;
  if (!token?.id) return null;

  const dbUser = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
    prisma.user.findUnique({
      where: { id: token.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        tenantId: true,
        authVersion: true,
        _count: { select: { reports: { where: { isActive: true } } } },
      },
    })
  );

  if (!dbUser) return null;              // deleted
  if (!dbUser.isActive) return null;     // deactivated
  if (token.tenantId && token.tenantId !== dbUser.tenantId) return null; // moved tenant

  // Tokens minted before authVersion existed carry no claim; treat them as version 1, which
  // is the column default, so this check does not sign out every existing session on deploy.
  const tokenVersion = token.authVersion ?? 1;
  if (tokenVersion !== dbUser.authVersion) return null;

  const role = dbUser.role as SessionUser['role'];
  return {
    id: dbUser.id,
    email: dbUser.email,
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    role,
    isManager: dbUser._count.reports > 0 || MANAGER_ROLES.includes(role),
    tenantId: dbUser.tenantId,
  };
});

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

/**
 * Whether the caller may *reference* a campaign supplied in a request body.
 *
 * Reaching a row by id and naming one in a payload are different attacks with different
 * defences. `canAccessLead` answers "may you touch this existing record"; this answers "may you
 * point a new record at this campaign", which is what a client actually controls when it POSTs
 * `campaignId`. `POST /api/leads` validated `assignedToId` and stamped `tenantId` from the
 * session, then passed `campaignId` straight through — so a tenant A SDR could create a lead
 * attached to tenant B's campaign, and did: reproduced at HTTP 201 in CI before this existed.
 * `lead -> campaign -> client` is the chain every report and client-facing export walks.
 *
 * Two separate questions, deliberately not collapsed into one:
 *
 *   1. does the campaign belong to the caller's tenant?
 *   2. is the caller allowed to reference it under the existing permission model?
 *
 * A campaign existing in your tenant does not mean every SDR may attach records to it, so the
 * second question reuses `getVisibleCampaignIds` — the same scoping that decides which campaigns
 * a caller can see — rather than inventing a parallel rule.
 *
 * The result distinguishes the two so routes can answer correctly without leaking existence:
 * a foreign-tenant or missing campaign is `'not_found'` (404, indistinguishable from a typo,
 * which is the convention `tenant-isolation.spec.ts` already accepts), while a real campaign the
 * caller may not use is `'forbidden'` (403).
 */
export type ReferenceCheck = 'ok' | 'not_found' | 'forbidden';

export async function canReferenceCampaign(
  viewer: SessionUser,
  campaignId: string
): Promise<ReferenceCheck> {
  // Tenant first, and explicitly: the Prisma extension scopes this read anyway, but a reference
  // check that depends on an ambient behaviour is one refactor away from silently passing.
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId: viewer.tenantId ?? undefined },
    select: { id: true },
  });
  if (!campaign) return 'not_found';

  const visible = await getVisibleCampaignIds(viewer);
  if (visible === null) return 'ok'; // director / leadgen manager — unrestricted within the tenant
  return visible.includes(campaignId) ? 'ok' : 'forbidden';
}

/**
 * Whether the caller may *reference* a client supplied in a request body.
 *
 * The contract is not invented here — it is the one `app/api/clients/route.ts` already applies
 * when listing clients: *"you see a client if you can see at least one of its campaigns"*,
 * resolved through `getVisibleCampaignIds`. Writing a different rule for references than for
 * reads would mean a caller could attach records to a client the product will not show them.
 *
 * Same three outcomes as `canReferenceCampaign`, for the same reason: a foreign-tenant or
 * missing client is `'not_found'` so foreign existence is never confirmable, while a real
 * in-tenant client the caller cannot see is `'forbidden'`.
 */
export async function canReferenceClient(
  viewer: SessionUser,
  clientId: string
): Promise<ReferenceCheck> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId: viewer.tenantId ?? undefined },
    select: { id: true },
  });
  if (!client) return 'not_found';

  const visible = await getVisibleCampaignIds(viewer);
  if (visible === null) return 'ok'; // director / leadgen manager — unrestricted within the tenant

  const reachable = await prisma.campaign.findFirst({
    where: { clientId, id: { in: visible } },
    select: { id: true },
  });
  return reachable ? 'ok' : 'forbidden';
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
