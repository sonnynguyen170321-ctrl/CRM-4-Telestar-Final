import { applyTransition, type TransitionResult } from './transitions';

/**
 * The AI-managed prospecting transitions (Phase 8a).
 *
 * Three named domain services, one per movement the prospecting loop makes while the prospect
 * is still AI-owned:
 *
 * ```text
 * unassigned ──markProspectResearching──▶ researching
 *            ──markProspectReadyForOutreach──▶ ready_for_outreach
 *            ──markProspectAIManaged──▶ ai_managed
 * ```
 *
 * They exist for the same reason `handoffProspectToHuman` does: `Lead.operatingState` is
 * written **only** by `applyTransition`, so a route, tool, planner or worker that wants a
 * prospect moved calls a named service rather than touching the column. Each carries its own
 * idempotency key, its own `fromStates` guard and its own audit Activity.
 *
 * None of these touch the prospect. Researching a lead, marking it ready and marking it
 * AI-managed are all internal bookkeeping — what the prospect actually receives is decided by
 * enrollment, which is a separate, approval-gated service.
 *
 * **Nothing here moves a prospect *out* of human ownership.** `human_managed` and
 * `human_attention` are absent from every `fromStates` list, so an AI-managed transition
 * cannot reclaim a prospect a person owns. Handback is an explicit SDR action and stays in
 * `lib/prospects/ownership.ts`, where 8d will extend it.
 */

export interface ProspectingTransitionInput {
  leadId: string;
  tenantId: string;
  /** The work order this ran under. It is also the transition's idempotency identity. */
  workOrderId: string;
  /** Recorded as the Activity actor. `Activity.userId` is a non-null FK. */
  actorUserId: string;
  systemInitiated?: boolean;
  /** Extra condition applied to the lead by the state write itself. */
  stateGuard?: Record<string, unknown>;
}

/**
 * An unassigned prospect has entered research.
 *
 * `researching` is also allowed as a starting state so a second research pass — a stale cache,
 * a re-run after a provider outage — is not an error. It resolves to a no-op through the
 * transition ledger when the work order is the same one.
 */
export async function markProspectResearching(
  input: ProspectingTransitionInput
): Promise<TransitionResult> {
  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: { kind: 'research_started', leadId: input.leadId, workOrderId: input.workOrderId },
    toState: 'researching',
    fromStates: ['unassigned', 'researching'],
    activityType: 'prospect_research_started',
    activityDescription: 'AI research started for this prospect',
    activityMetadata: { workOrderId: input.workOrderId },
    actorUserId: input.actorUserId,
    systemInitiated: input.systemInitiated ?? true,
    workOrderId: input.workOrderId,
  });
}

/**
 * Research is done and the prospect is ready for outreach to be *designed*.
 *
 * Reaching this state grants nothing: it says the evidence exists, not that anything may be
 * sent. Enrollment still goes through capability authorization and, at the default policy,
 * a human approval.
 */
export async function markProspectReadyForOutreach(
  input: ProspectingTransitionInput
): Promise<TransitionResult> {
  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: { kind: 'ready_for_outreach', leadId: input.leadId, workOrderId: input.workOrderId },
    toState: 'ready_for_outreach',
    fromStates: ['unassigned', 'researching', 'ready_for_outreach'],
    activityType: 'prospect_ready_for_outreach',
    activityDescription: 'Research complete — prospect ready for outreach design',
    activityMetadata: { workOrderId: input.workOrderId },
    actorUserId: input.actorUserId,
    systemInitiated: input.systemInitiated ?? true,
    workOrderId: input.workOrderId,
  });
}

/**
 * Outreach is live and the AI is now responsible for this prospect's cadence.
 *
 * Called **after** enrollment succeeds, never before — the state describes what is true, and a
 * prospect marked `ai_managed` with no enrollment behind it is a lie the conflict checker
 * would then act on.
 */
export async function markProspectAIManaged(
  input: ProspectingTransitionInput
): Promise<TransitionResult> {
  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: { kind: 'ai_managed_started', leadId: input.leadId, workOrderId: input.workOrderId },
    toState: 'ai_managed',
    fromStates: ['unassigned', 'researching', 'ready_for_outreach', 'ai_managed'],
    activityType: 'prospect_ai_managed',
    activityDescription: 'Outreach activated — prospect is AI-managed',
    activityMetadata: { workOrderId: input.workOrderId },
    stateGuard: input.stateGuard,
    actorUserId: input.actorUserId,
    systemInitiated: input.systemInitiated ?? true,
    workOrderId: input.workOrderId,
  });
}
