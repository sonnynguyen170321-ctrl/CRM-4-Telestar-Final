import {
  CAPABILITY_CEILING,
  WRITE_CAPABILITIES,
  type AgentCapability,
} from '@/lib/agent/capabilities';

/**
 * Typed work orders — the vocabulary (Revenue AI Phase 6a).
 *
 * Import-free of Prisma on purpose, for the same reason `lib/agent/capabilities.ts` is: this
 * module says what a work order *is* and what it may never exceed. The rows live in the
 * database; the bounds live here, where the whole set can be read in one screen.
 *
 * ## The type is what bounds tool access
 *
 * A work order does not carry a free-form capability list a caller can widen. Its **type**
 * declares the set, and the set is an **additional ceiling only** — it can forbid a capability
 * the agent policy would have allowed, and it can never permit one the policy forbids. The
 * composition lives in `./authorization`, and `tests/work-order-authorization.test.ts` pins
 * that direction so a future edit cannot quietly invert it.
 */

export type WorkOrderType =
  | 'prospect_batch'
  | 'research_batch'
  | 'sequence_design'
  | 'outreach_launch'
  | 'followup'
  | 'reengagement'
  | 'reply_review'
  | 'campaign_analysis'
  | 'lead_quality_analysis';

export const ALL_WORK_ORDER_TYPES: readonly WorkOrderType[] = [
  'prospect_batch',
  'research_batch',
  'sequence_design',
  'outreach_launch',
  'followup',
  'reengagement',
  'reply_review',
  'campaign_analysis',
  'lead_quality_analysis',
];

export function isWorkOrderType(value: string): value is WorkOrderType {
  return (ALL_WORK_ORDER_TYPES as readonly string[]).includes(value);
}

/**
 * What each type of work may touch.
 *
 * Read these as job descriptions rather than permission grants — the agent still has to clear
 * capability autonomy, role authorization and object scope underneath. Two boundaries are
 * deliberate and worth stating:
 *
 * - **`sequence_design` cannot enroll.** Designing outreach and launching it are different
 *   work orders precisely so the approval that matters attaches to the launch. A single
 *   "build and send it" order would make the draft's approval look like consent to send.
 * - **`campaign_analysis` writes nothing.** An analysis that can also create tasks stops being
 *   an analysis and becomes an unreviewed manager action.
 *
 * `prospect_reply` and `place_call` appear in no set at all. They are `human_only` at the
 * ceiling as well, so this is the second of two independent locks rather than the only one.
 */
export const WORK_ORDER_CAPABILITIES: Record<WorkOrderType, readonly AgentCapability[]> = {
  prospect_batch: ['research', 'notes', 'tasks'],
  research_batch: ['research', 'notes'],
  sequence_design: ['research', 'summarize', 'sequence_draft'],
  outreach_launch: ['sequence_enroll', 'send_window_change', 'notes', 'tasks'],
  followup: ['summarize', 'draft_reply', 'meeting_prep', 'notes', 'tasks', 'reminders'],
  reengagement: ['research', 'reengagement_propose', 'reengagement_activate', 'notes', 'tasks'],
  reply_review: ['summarize', 'draft_reply', 'objection_help', 'meeting_prep', 'notes', 'tasks'],
  campaign_analysis: ['research', 'summarize'],
  lead_quality_analysis: ['research', 'summarize', 'notes'],
};

/** True when this type declares this capability. An unknown type is false, not permissive. */
export function workOrderTypePermits(
  type: WorkOrderType,
  capability: AgentCapability
): boolean {
  const permitted = WORK_ORDER_CAPABILITIES[type];
  return permitted ? permitted.includes(capability) : false;
}

/**
 * Whether exercising a capability is something the **prospect experiences**.
 *
 * `touches_prospect` means the prospect receives something, or what they receive changes.
 * `internal` means the effect lands inside the CRM or in front of the SDR — a draft is
 * `internal` until something sends it, and a proposal is `internal` until something activates it.
 *
 * ## Why this is a total Record and not a Set
 *
 * `Record<AgentCapability, ProspectEffect>` is **exhaustive at compile time**: adding a value to
 * `AgentCapability` breaks the build here until it is classified. The previous shape was a `Set`
 * of the touching ones, which silently defaulted every future capability to `internal` — failing
 * *open*, on the classification that decides whether a human-owned prospect can be touched. A
 * new capability must not be able to arrive un-classified, and it must not be able to arrive
 * classified by omission.
 */
export type ProspectEffect = 'touches_prospect' | 'internal';

export const CAPABILITY_PROSPECT_EFFECT: Record<AgentCapability, ProspectEffect> = {
  // Assistance — reads, summarises, drafts. The prospect experiences none of it.
  research: 'internal',
  summarize: 'internal',
  draft_reply: 'internal',
  objection_help: 'internal',
  meeting_prep: 'internal',
  // CRM writes on the SDR's behalf. Visible to the team, not to the prospect.
  notes: 'internal',
  tasks: 'internal',
  reminders: 'internal',
  // A draft is not a send, and a proposal is not an activation. `reengagement_propose` is inert
  // by design (ARCHITECTURE §4.2a) — it produces eligibility and a recommendation, never an
  // enrollment — so it is `internal` and its activating sibling is not.
  sequence_draft: 'internal',
  reengagement_propose: 'internal',
  // The prospect receives something, or what they receive changes.
  sequence_enroll: 'touches_prospect',
  send_window_change: 'touches_prospect',
  reengagement_activate: 'touches_prospect',
  prospect_reply: 'touches_prospect',
  // Preparing a human's call is internal. Placing one is the prospect's phone ringing.
  call_assistance: 'internal',
  place_call: 'touches_prospect',
};

/**
 * Capabilities that reach the prospect rather than the CRM — derived, never hand-listed.
 *
 * This is the set `human_managed` blocks. It is narrower than `WRITE_CAPABILITIES` on purpose:
 * a note or a task is a write the SDR asked for, while an enrollment is something the prospect
 * receives. ARCHITECTURE §4.3 — `human_managed` means "AI may not touch the prospect", not
 * "AI off", so summaries, reply drafts, objection help and meeting prep stay available.
 */
export const PROSPECT_TOUCHING_CAPABILITIES: ReadonlySet<AgentCapability> = new Set(
  (Object.keys(CAPABILITY_PROSPECT_EFFECT) as AgentCapability[]).filter(
    (capability) => CAPABILITY_PROSPECT_EFFECT[capability] === 'touches_prospect'
  )
);

/**
 * Whether a type can reach the prospect, **derived** from its capability set.
 *
 * Deliberately not a second hand-maintained list. A declared list would silently disagree with
 * the capability sets the first time someone added `sequence_enroll` to a type and forgot the
 * other file — and the disagreement would fail open, which is the wrong direction for the
 * check that decides whether a human-owned prospect can be touched.
 */
export function isProspectTouching(type: WorkOrderType): boolean {
  return (WORK_ORDER_CAPABILITIES[type] ?? []).some((capability) =>
    PROSPECT_TOUCHING_CAPABILITIES.has(capability)
  );
}

/**
 * How a work order holds a lead while it executes.
 *
 * `exclusive` is execution protection: two work orders that can both reach the prospect must
 * not run against one lead at the same time. `shared` is for assistance work that observes and
 * annotates — several of those may overlap, and blocking them would make the agent useless
 * exactly when an SDR is working the lead.
 *
 * Derived from the capability set for the same reason `isProspectTouching` is.
 */
export type LeaseMode = 'exclusive' | 'shared';

export function leaseModeForType(type: WorkOrderType): LeaseMode {
  return isProspectTouching(type) ? 'exclusive' : 'shared';
}

/**
 * Work order lifecycle.
 *
 * `paused` carries a reason rather than splitting into `budget_exhausted`, `blocked` and
 * friends. Phase 0 of this initiative was a bug caused by three vocabularies for one paused
 * state; one status plus one reason vocabulary, both in this file, is the shape that cannot
 * diverge.
 */
export type WorkOrderStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export const ALL_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
  'failed',
];

/** Statuses that hold a lead. Anything else releases it. */
export const OCCUPYING_STATUSES: readonly WorkOrderStatus[] = ['active', 'paused'];

/**
 * Why a work order is paused.
 *
 * `budget_exhausted` is a first-class reason rather than a failure: exhausting a budget is the
 * budget working. Phase 6b enforces it incrementally and reports partial completion; 6a only
 * has to make the vocabulary exist so the enforcement point has one word to write.
 */
export type WorkOrderPausedReason =
  | 'budget_exhausted'
  | 'awaiting_approval'
  | 'manual'
  | 'conflict'
  | 'provider_unavailable';

export const ALL_PAUSED_REASONS: readonly WorkOrderPausedReason[] = [
  'budget_exhausted',
  'awaiting_approval',
  'manual',
  'conflict',
  'provider_unavailable',
];

export function isWorkOrderPausedReason(value: string): value is WorkOrderPausedReason {
  return (ALL_PAUSED_REASONS as readonly string[]).includes(value);
}

/**
 * Execution budgets.
 *
 * Four separate limits rather than one, because they fail differently: tokens are money,
 * research credits are money at a different rate, tool calls bound blast radius, and duration
 * bounds a stuck run. A single "cost" number would let a work order loop forever inside its
 * budget.
 *
 * ## Units — fixed here so Phase 6b does not invent them
 *
 * 6a validates and stores these; 6b enforces them incrementally and writes the consumption
 * counters. The counters must measure exactly what is written below, or a budget will be
 * enforced against a different quantity than the one an operator thought they set.
 *
 * | Field | Unit | Counted as | Source of truth for consumption |
 * |---|---|---|---|
 * | `researchBudget` | billable research operations | 1 per web search, 1 per page fetch | `AiCall.searchCredits`, summed over the work order |
 * | `tokenBudget` | provider tokens | `promptTokens + completionTokens` per round trip | `AiCall.totalTokens`, summed over the work order |
 * | `maxToolCalls` | tool invocations | 1 per `executeTool` entry, success or failure | `AgentAction` rows for the work order |
 * | `maxExecutionDuration` | **seconds** | wall clock from `WorkOrder.activatedAt` | `now - activatedAt`, not summed CPU or per-attempt time |
 *
 * Three consequences worth stating, because each is a plausible wrong reading:
 *
 * - **A failed tool call still spends `maxToolCalls`.** A budget that only counted successes
 *   would let a retry loop run unbounded, which is the exact case the limit exists for.
 * - **Tokens are counted per provider round trip, not per SDR exchange.** One tool-calling
 *   conversation produces several `AiCall` rows; that is deliberate (PLAN Phase 1) and the
 *   budget sums them.
 * - **Duration is wall clock from the first activation, not accumulated running time.** A
 *   pause/resume cycle does not refund it — `WorkOrder.activatedAt` is set once for this reason.
 */
export interface WorkOrderBudgets {
  /** Billable research operations — one web search, one page fetch. */
  researchBudget: number;
  /** Total provider tokens (prompt + completion) across every model round trip. */
  tokenBudget: number;
  /** Tool invocations, successful or not. */
  maxToolCalls: number;
  /** Wall-clock **seconds** measured from `WorkOrder.activatedAt`. */
  maxExecutionDuration: number;
}

export interface BudgetBound {
  min: number;
  max: number;
}

/**
 * Hard bounds, enforced at the domain boundary.
 *
 * The maxima are not tuned economics — they are a stop on the value that turns a budget into
 * no budget. An unbounded `tokenBudget` is indistinguishable from an absent one.
 */
export const BUDGET_BOUNDS: Record<keyof WorkOrderBudgets, BudgetBound> = {
  researchBudget: { min: 0, max: 1_000 },
  tokenBudget: { min: 0, max: 10_000_000 },
  maxToolCalls: { min: 1, max: 500 },
  maxExecutionDuration: { min: 60, max: 86_400 },
};

/** Conservative starting point when a caller names no budget. */
export const DEFAULT_BUDGETS: WorkOrderBudgets = {
  researchBudget: 50,
  tokenBudget: 250_000,
  maxToolCalls: 50,
  maxExecutionDuration: 3_600,
};

export type BudgetField = keyof WorkOrderBudgets;

export const BUDGET_FIELDS: readonly BudgetField[] = [
  'researchBudget',
  'tokenBudget',
  'maxToolCalls',
  'maxExecutionDuration',
];

export interface BudgetViolation {
  field: BudgetField;
  value: number;
  bound: BudgetBound;
  reason: 'not_an_integer' | 'below_minimum' | 'above_maximum';
}

/**
 * Validate a budget set, returning every violation rather than the first.
 *
 * All of them, because these arrive together from one form or one API call and fixing them one
 * round trip at a time is a worse API than saying what is wrong once.
 */
export function validateBudgets(budgets: Partial<WorkOrderBudgets>): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  for (const field of BUDGET_FIELDS) {
    const value = budgets[field];
    if (value === undefined) continue;

    const bound = BUDGET_BOUNDS[field];
    if (!Number.isInteger(value)) {
      violations.push({ field, value, bound, reason: 'not_an_integer' });
      continue;
    }
    if (value < bound.min) violations.push({ field, value, bound, reason: 'below_minimum' });
    else if (value > bound.max) violations.push({ field, value, bound, reason: 'above_maximum' });
  }

  return violations;
}

/** Fill unspecified budgets from the defaults. Does not validate — call `validateBudgets` first. */
export function withBudgetDefaults(budgets: Partial<WorkOrderBudgets>): WorkOrderBudgets {
  return {
    researchBudget: budgets.researchBudget ?? DEFAULT_BUDGETS.researchBudget,
    tokenBudget: budgets.tokenBudget ?? DEFAULT_BUDGETS.tokenBudget,
    maxToolCalls: budgets.maxToolCalls ?? DEFAULT_BUDGETS.maxToolCalls,
    maxExecutionDuration:
      budgets.maxExecutionDuration ?? DEFAULT_BUDGETS.maxExecutionDuration,
  };
}

/**
 * Capabilities no work order type may ever declare.
 *
 * Derived from the ceiling rather than restated, so raising a capability to `human_only` in
 * `lib/agent/capabilities.ts` automatically bars it here too. A structural test asserts no
 * type's set intersects this.
 */
export function humanOnlyCapabilities(): AgentCapability[] {
  return (Object.keys(CAPABILITY_CEILING) as AgentCapability[]).filter(
    (capability) => CAPABILITY_CEILING[capability] === 'human_only'
  );
}

/** Write-capable members of a type's set — used by the lease and conflict rules. */
export function writeCapabilitiesForType(type: WorkOrderType): AgentCapability[] {
  return (WORK_ORDER_CAPABILITIES[type] ?? []).filter((capability) =>
    WRITE_CAPABILITIES.has(capability)
  );
}
