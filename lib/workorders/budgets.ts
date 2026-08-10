import { prisma } from '@/lib/prisma';
import type { WorkOrder } from '@prisma/client';

/**
 * Incremental budget enforcement (Revenue AI Phase 6b).
 *
 * 6a validated and stored the four budgets; this is what spends them. The rule from
 * ARCHITECTURE §13 is that exhaustion **pauses the work order and reports partial completion —
 * never a silent overspend**, and never a completion that was really a stop.
 *
 * ## The guarantee, stated exactly
 *
 * The check runs *before* each operation and asks "is there anything left", not "will this
 * one fit". It cannot ask the second question: the token cost of a model call is unknown until
 * the call returns, and the page count of a research operation is unknown until it runs. So:
 *
 * ```text
 * guaranteed   no operation STARTS once a budget is exhausted
 * not claimed  no operation EXCEEDS the budget
 * ```
 *
 * A work order can therefore overshoot by at most the cost of one operation. That is bounded,
 * visible in the counters, and the honest description of what a pre-flight check on an unknown
 * cost can promise. Pretending otherwise would mean reserving a worst-case spend per call, which
 * makes every budget effectively far smaller than the number an operator typed.
 *
 * ## Why the counters are denormalised
 *
 * `AiCall` and `AgentAction` are authoritative — they are the per-round-trip and per-invocation
 * records, and `reconcileConsumption` recomputes the counters from them. The counters exist
 * because this check runs before *every* tool call, and two aggregate queries per call is a cost
 * the hot path should not pay. Where the two disagree, the ledgers win.
 */

export type BudgetKind = 'research' | 'tokens' | 'tool_calls' | 'duration';

export const ALL_BUDGET_KINDS: readonly BudgetKind[] = [
  'research',
  'tokens',
  'tool_calls',
  'duration',
];

export interface BudgetSnapshot {
  researchRemaining: number;
  tokensRemaining: number;
  toolCallsRemaining: number;
  /** Negative once the wall clock has passed `activatedAt + maxExecutionDuration`. */
  secondsRemaining: number;
  /** Every kind with nothing left. Empty means the work order may continue. */
  exhausted: BudgetKind[];
}

type BudgetFields = Pick<
  WorkOrder,
  | 'researchBudget'
  | 'tokenBudget'
  | 'maxToolCalls'
  | 'maxExecutionDuration'
  | 'researchUsed'
  | 'tokensUsed'
  | 'toolCallsUsed'
  | 'activatedAt'
>;

/**
 * What is left, and what has run out.
 *
 * Pure — takes the row rather than an id — so the enforcement rule can be tested exhaustively
 * without a database, and so a caller that already loaded the work order does not re-read it
 * before every single tool call.
 */
export function budgetSnapshot(order: BudgetFields, now: Date = new Date()): BudgetSnapshot {
  const researchRemaining = order.researchBudget - order.researchUsed;
  const tokensRemaining = order.tokenBudget - order.tokensUsed;
  const toolCallsRemaining = order.maxToolCalls - order.toolCallsUsed;

  // An order that has never been activated has spent no wall clock. Treating a null
  // `activatedAt` as "started at the epoch" would report every draft as out of time.
  const secondsRemaining = order.activatedAt
    ? order.maxExecutionDuration -
      Math.floor((now.getTime() - order.activatedAt.getTime()) / 1_000)
    : order.maxExecutionDuration;

  const exhausted: BudgetKind[] = [];
  if (researchRemaining <= 0) exhausted.push('research');
  if (tokensRemaining <= 0) exhausted.push('tokens');
  if (toolCallsRemaining <= 0) exhausted.push('tool_calls');
  if (secondsRemaining <= 0) exhausted.push('duration');

  return {
    researchRemaining,
    tokensRemaining,
    toolCallsRemaining,
    secondsRemaining,
    exhausted,
  };
}

/** True when every budget still has room. */
export function hasBudgetRemaining(order: BudgetFields, now: Date = new Date()): boolean {
  return budgetSnapshot(order, now).exhausted.length === 0;
}

/** One sentence naming what ran out, for the pause record and the operator. */
export function describeExhaustion(snapshot: BudgetSnapshot): string {
  if (snapshot.exhausted.length === 0) return 'no budget exhausted';
  return snapshot.exhausted
    .map((kind) => {
      switch (kind) {
        case 'research':
          return 'research operations';
        case 'tokens':
          return 'token budget';
        case 'tool_calls':
          return 'tool call limit';
        case 'duration':
          return 'execution time';
      }
    })
    .join(', ');
}

export interface ConsumptionDelta {
  research?: number;
  tokens?: number;
  toolCalls?: number;
}

/**
 * Debit the counters.
 *
 * `increment` rather than read-modify-write: two concurrent tool calls on one work order must
 * not lose a debit to a lost update, and Postgres does the addition atomically in one statement
 * — which matters because the Neon HTTP driver has no interactive transaction to wrap a
 * read-then-write in.
 *
 * Never throws. A failure to record spend must not fail the work order — the ledgers still hold
 * the truth and `reconcileConsumption` can repair the counters — but it is logged loudly,
 * because silently stopping counting turns a budget into no budget.
 */
export async function recordConsumption(
  tenantId: string,
  workOrderId: string,
  delta: ConsumptionDelta
): Promise<void> {
  const data: Record<string, { increment: number }> = {};
  if (delta.research) data.researchUsed = { increment: delta.research };
  if (delta.tokens) data.tokensUsed = { increment: delta.tokens };
  if (delta.toolCalls) data.toolCallsUsed = { increment: delta.toolCalls };

  if (Object.keys(data).length === 0) return;

  try {
    await prisma.workOrder.updateMany({ where: { id: workOrderId, tenantId }, data });
  } catch (err) {
    console.error(
      `[workorders/budgets] failed to record consumption for work order ${workOrderId}:`,
      err
    );
  }
}

export interface ReconciledConsumption {
  research: number;
  tokens: number;
  toolCalls: number;
  /** True when the stored counters disagreed with the ledgers and were corrected. */
  drifted: boolean;
}

/**
 * Recompute the counters from the authoritative ledgers and correct any drift.
 *
 * `AiCall` carries spend per provider round trip and `AgentAction` one row per tool invocation,
 * so both are recomputable. Drift is expected rather than exceptional: `recordConsumption` is
 * deliberately non-throwing, so a database blip during a run leaves the counters low. Reporting
 * `drifted` rather than silently fixing it means a persistent gap is visible instead of being
 * papered over on every call.
 */
export async function reconcileConsumption(
  tenantId: string,
  workOrderId: string
): Promise<ReconciledConsumption> {
  const [spend, toolCalls, order] = await Promise.all([
    prisma.aiCall.aggregate({
      where: { tenantId, workOrderId },
      _sum: { totalTokens: true, searchCredits: true },
    }),
    prisma.agentAction.count({ where: { tenantId, workOrderId } }),
    prisma.workOrder.findFirst({
      where: { id: workOrderId, tenantId },
      select: { researchUsed: true, tokensUsed: true, toolCallsUsed: true },
    }),
  ]);

  const research = spend._sum.searchCredits ?? 0;
  const tokens = spend._sum.totalTokens ?? 0;

  const drifted =
    order !== null &&
    (order.researchUsed !== research ||
      order.tokensUsed !== tokens ||
      order.toolCallsUsed !== toolCalls);

  if (drifted) {
    await prisma.workOrder.updateMany({
      where: { id: workOrderId, tenantId },
      data: { researchUsed: research, tokensUsed: tokens, toolCallsUsed: toolCalls },
    });
  }

  return { research, tokens, toolCalls, drifted };
}
