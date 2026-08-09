import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import {
  CAPABILITY_CEILING,
  CAPABILITY_ROLE_REQUIREMENT,
  DEFAULT_AUTONOMY,
  isAutonomyMode,
  strictest,
  type AgentCapability,
  type AutonomyMode,
} from './capabilities';

/**
 * The single enforcement point for agent capabilities (Revenue AI Phase 2).
 *
 * Two things this is **not**:
 *
 *   1. It is not a replacement for CRM authorization. Tenancy, role scoping and the pod
 *      hierarchy still run underneath, in the domain services the agent calls. Autonomy can
 *      only ever *restrict* what a role could already do — never widen it. A capability with
 *      a role requirement is denied for a role that lacks it no matter what the policy says.
 *
 *   2. It is not a per-call-site check. Every capability resolves through `authorizeCapability`
 *      so a new tool cannot invent its own rule, and so the resolution order — ceiling, then
 *      stored policy, then default, strictest wins — exists in exactly one place.
 */

export type AuthorizationOutcome =
  /** Proceed now. */
  | 'allow'
  /** The action is permitted but needs a human to approve it first. */
  | 'needs_approval'
  /** The action needs a manager, not just any human. */
  | 'needs_manager_approval'
  /** Never automatable. */
  | 'denied';

export interface CapabilityDecision {
  capability: AgentCapability;
  outcome: AuthorizationOutcome;
  /** The mode that produced this outcome, after ceiling and policy resolution. */
  mode: AutonomyMode;
  /** Machine-stable explanation, for logs and for the approval UI. */
  reason:
    | 'auto'
    | 'policy_requires_approval'
    | 'policy_requires_manager_approval'
    | 'capability_is_human_only'
    | 'role_not_permitted';
}

const MANAGER_ROLES: readonly SessionUser['role'][] = ['director', 'floor_manager', 'team_lead'];

/**
 * Resolve the effective mode for a capability.
 *
 * Strictest wins across three sources, which is the only ordering that makes a ceiling
 * meaningful: a stored `auto` must not be able to loosen a `human_only` ceiling.
 */
export function resolveMode(
  capability: AgentCapability,
  storedMode: AutonomyMode | null | undefined
): AutonomyMode {
  const base = storedMode ?? DEFAULT_AUTONOMY[capability];
  const ceiling = CAPABILITY_CEILING[capability];
  return ceiling ? strictest(base, ceiling) : base;
}

/**
 * Decide whether an agent may exercise a capability for this user, right now.
 *
 * `storedMode` is passed in rather than fetched so the pure decision can be tested without a
 * database and so a caller that already loaded the tenant's policy does not re-query per tool
 * call. `authorizeCapability` is the loading wrapper.
 */
export function decideCapability(
  user: Pick<SessionUser, 'role'>,
  capability: AgentCapability,
  storedMode: AutonomyMode | null | undefined
): CapabilityDecision {
  // CRM role authorization first. Autonomy layers on top of it and cannot substitute for it,
  // so a role that may not perform the underlying action is denied before policy is consulted.
  const requiredRoles = CAPABILITY_ROLE_REQUIREMENT[capability];
  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return {
      capability,
      outcome: 'denied',
      mode: 'human_only',
      reason: 'role_not_permitted',
    };
  }

  const mode = resolveMode(capability, storedMode);

  switch (mode) {
    case 'auto':
      return { capability, outcome: 'allow', mode, reason: 'auto' };
    case 'approval':
      return {
        capability,
        outcome: 'needs_approval',
        mode,
        reason: 'policy_requires_approval',
      };
    case 'manager_approval':
      return {
        capability,
        outcome: 'needs_manager_approval',
        mode,
        reason: 'policy_requires_manager_approval',
      };
    case 'human_only':
      return {
        capability,
        outcome: 'denied',
        mode,
        reason: 'capability_is_human_only',
      };
  }
}

/** True when this user may sign off a `manager_approval` capability. */
export function canApproveAsManager(user: Pick<SessionUser, 'role'>): boolean {
  return MANAGER_ROLES.includes(user.role);
}

/**
 * Load the tenant's policy for one capability and decide.
 *
 * A missing row means "no override" and falls through to the default — absence is not
 * denial, or a tenant that has never opened the settings page would have a mute agent.
 * A malformed stored value is treated as absent rather than trusted.
 */
export async function authorizeCapability(
  user: Pick<SessionUser, 'role' | 'tenantId'>,
  capability: AgentCapability
): Promise<CapabilityDecision> {
  let storedMode: AutonomyMode | null = null;

  if (user.tenantId) {
    try {
      const row = await prisma.autonomyPolicy.findUnique({
        where: {
          tenantId_role_capability: {
            tenantId: user.tenantId,
            role: user.role,
            capability,
          },
        },
        select: { mode: true },
      });
      if (row && isAutonomyMode(row.mode)) storedMode = row.mode;
    } catch (err) {
      // Fail closed to the default rather than to `auto`: an unreadable policy must not
      // become permission. The default itself is conservative for anything prospect-facing.
      console.error('[agent/authorization] policy lookup failed:', err);
    }
  }

  return decideCapability(user, capability, storedMode);
}

/** Convenience for call sites that only proceed on a clean allow. */
export function isAllowed(decision: CapabilityDecision): boolean {
  return decision.outcome === 'allow';
}
