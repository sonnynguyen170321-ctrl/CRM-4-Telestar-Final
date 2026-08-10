import {
  authorizeCapability,
  decideCapability,
  type AuthorizationOutcome,
  type CapabilityDecision,
} from '@/lib/agent/authorization';
import type { AgentCapability, AutonomyMode } from '@/lib/agent/capabilities';
import type { SessionUser } from '@/lib/auth';
import { workOrderTypePermits, type WorkOrderType } from './types';

/**
 * Work order capability bounds (Revenue AI Phase 6a).
 *
 * The one rule this file exists to make structural:
 *
 * ```text
 * WorkOrder type permits capability
 *   → agent capability / autonomy authorization   (lib/agent/authorization.ts)
 *     → CRM role authorization                    (inside decideCapability)
 *       → CRM object / domain authorization       (inside the domain services)
 *         → execution
 * ```
 *
 * The work order gate is **first and subtractive**. It can refuse a capability the agent policy
 * would have allowed; it can never turn a policy refusal into permission, because the only
 * thing it does on the permitting branch is hand the decision to `decideCapability` unchanged.
 * There is no branch here that constructs an `ALLOW`.
 *
 * That asymmetry is the whole design. A work order is a *narrower* context for work the agent
 * could already do — an "outreach launch" order does not grant enrollment rights, it restricts
 * an already-enrolled-capable agent to enrollment-shaped work.
 */

/** Why the work order layer, specifically, refused. */
export type WorkOrderRefusalReason = 'not_permitted_by_work_order_type';

export interface WorkOrderCapabilityDecision {
  capability: AgentCapability;
  workOrderType: WorkOrderType;
  outcome: AuthorizationOutcome;
  mode: AutonomyMode;
  reason: CapabilityDecision['reason'] | WorkOrderRefusalReason;
  /**
   * What the agent policy alone would have decided.
   *
   * Carried so "the work order never widens" is checkable against the composed result rather
   * than re-derived by the caller — and so a test can assert the relationship on every
   * capability × type × role combination instead of trusting the branch structure.
   *
   * Null only when the work order gate refused before the policy was consulted: there is no
   * underlying decision in that case, and inventing one would imply the policy was asked.
   */
  capabilityDecision: CapabilityDecision | null;
}

/**
 * Compose the work order bound over a capability decision.
 *
 * `storedMode` is passed in rather than fetched, matching `decideCapability`, so the whole
 * composition stays pure and testable without a database.
 */
export function decideWorkOrderCapability(
  workOrderType: WorkOrderType,
  user: Pick<SessionUser, 'role'>,
  capability: AgentCapability,
  storedMode: AutonomyMode | null | undefined
): WorkOrderCapabilityDecision {
  if (!workOrderTypePermits(workOrderType, capability)) {
    return {
      capability,
      workOrderType,
      outcome: 'DENY',
      mode: 'human_only',
      reason: 'not_permitted_by_work_order_type',
      capabilityDecision: null,
    };
  }

  // The permitting branch adds nothing. Whatever the agent policy decided — allow, either
  // approval, or deny — is the answer, verbatim.
  const decision = decideCapability(user, capability, storedMode);
  return {
    capability,
    workOrderType,
    outcome: decision.outcome,
    mode: decision.mode,
    reason: decision.reason,
    capabilityDecision: decision,
  };
}

/** Load the tenant's policy and decide, inside a work order's bounds. */
export async function authorizeWorkOrderCapability(
  workOrderType: WorkOrderType,
  user: Pick<SessionUser, 'role' | 'tenantId'>,
  capability: AgentCapability
): Promise<WorkOrderCapabilityDecision> {
  if (!workOrderTypePermits(workOrderType, capability)) {
    // Refuse before the policy lookup. Not an optimisation: a work order that may not use a
    // capability has no business reading the tenant's policy for it.
    return {
      capability,
      workOrderType,
      outcome: 'DENY',
      mode: 'human_only',
      reason: 'not_permitted_by_work_order_type',
      capabilityDecision: null,
    };
  }

  const decision = await authorizeCapability(user, capability);
  return {
    capability,
    workOrderType,
    outcome: decision.outcome,
    mode: decision.mode,
    reason: decision.reason,
    capabilityDecision: decision,
  };
}

/** Convenience for call sites that only proceed on a clean allow. */
export function isWorkOrderAllowed(decision: WorkOrderCapabilityDecision): boolean {
  return decision.outcome === 'ALLOW';
}

/**
 * Ordering of outcomes from most to least permissive.
 *
 * Exported because the "never widens" property is stated in terms of it, and a test that
 * re-implements the ordering is testing its own copy rather than this one.
 */
const OUTCOME_PERMISSIVENESS: Record<AuthorizationOutcome, number> = {
  ALLOW: 0,
  REQUIRE_USER_APPROVAL: 1,
  REQUIRE_MANAGER_APPROVAL: 2,
  DENY: 3,
};

/** True when `composed` is no more permissive than `underlying`. */
export function isNoMorePermissiveThan(
  composed: AuthorizationOutcome,
  underlying: AuthorizationOutcome
): boolean {
  return OUTCOME_PERMISSIVENESS[composed] >= OUTCOME_PERMISSIVENESS[underlying];
}

/**
 * The human-facing refusal for a work order bound.
 *
 * Distinct from the agent-policy refusals in `lib/agent/runtime.ts` because the remedy is
 * different: a policy refusal is answered by approval, this one by using the right kind of
 * work order. Saying "needs approval" when the answer is "wrong work order" sends the SDR to
 * their manager for a signature that would change nothing.
 */
export function workOrderRefusalMessage(decision: WorkOrderCapabilityDecision): string {
  if (decision.reason === 'not_permitted_by_work_order_type') {
    return `A "${decision.workOrderType}" work order does not cover the "${decision.capability}" capability. No changes were made. This needs a work order of a type that does — approval will not unlock it.`;
  }
  return 'That action could not be authorized inside this work order. No changes were made.';
}
