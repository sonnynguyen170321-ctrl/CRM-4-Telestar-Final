import type { WorkOrder } from '@prisma/client';
import type { PlannedToolCall } from './execution';

/**
 * What a work order intends to do — the seam, not the planner (Revenue AI Phase 6b).
 *
 * **This deliberately returns nothing yet.** Deciding which tools a work order should run is
 * Phase 7 (knowledge retrieval and structured research) and Phase 8 (the prospecting loop).
 * Phase 6b's job is the machinery that runs a plan safely — budgets, authorization, approvals,
 * provenance, idempotency, partial completion — and that machinery is complete and tested
 * against explicit step lists.
 *
 * Writing a planner here to have something to execute would be exactly the speculative
 * generality this initiative keeps refusing, and worse: a placeholder planner that enrolled or
 * researched anything would be autonomous prospect work shipped under a phase whose scope
 * explicitly excludes it. An empty plan completes immediately and touches nothing, which is the
 * correct behaviour for a system that has not yet been told what to do.
 *
 * The seam exists so Phase 7/8 has one function to implement and the worker needs no change.
 */
export async function planWorkOrderSteps(_order: WorkOrder): Promise<PlannedToolCall[]> {
  return [];
}
