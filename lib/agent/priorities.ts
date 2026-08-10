/**
 * SLA priority for agent work (Revenue AI Phase 6b).
 *
 * ARCHITECTURE §13 states the ordering as a product requirement rather than a tuning knob:
 *
 * ```text
 * prospect reply / meeting request  >  interactive SDR command  >  work order execution  >  bulk research
 * ```
 *
 * and the reason is one sentence long — **bulk research must never delay a handoff.** A
 * prospect who replies is the most perishable thing this system handles; a research batch is
 * the least. Left to arrival order, a thousand queued research jobs sit in front of the one
 * reply that had an SLA clock on it.
 *
 * Import-free of Prisma and of BullMQ, deliberately: this is the vocabulary, and it is asserted
 * against by tests that must not need Redis to run.
 *
 * ## Not every class has a producer yet
 *
 * Phase 6b's only real producer is work order execution. `prospect_reply` and
 * `interactive_command` are declared now because the *contract* is what has to be fixed before
 * several producers exist — a priority scheme retrofitted across four call sites already in
 * production is how the ordering ends up meaning nothing. The tests pin the ordering, not the
 * existence of producers.
 */

export type AgentSlaClass =
  /** A prospect replied, or asked for a meeting. Perishable, and on an SLA clock. */
  | 'prospect_reply'
  /** An SDR is sitting in front of the app waiting for this answer. */
  | 'interactive_command'
  /** A typed work order executing its steps. */
  | 'work_order'
  /** Bulk enrichment and research. Valuable, never urgent. */
  | 'bulk_research';

/**
 * Declared strictly most- to least-urgent. The array order *is* the contract, and the test
 * derives the expected numeric ordering from it rather than restating it.
 */
export const AGENT_SLA_ORDER: readonly AgentSlaClass[] = [
  'prospect_reply',
  'interactive_command',
  'work_order',
  'bulk_research',
];

/**
 * BullMQ priorities. **Lower runs first** — this is BullMQ's convention, not ours, and it is
 * the single most likely thing for a future edit to get backwards.
 *
 * Gaps of 10 leave room to slot a class between two existing ones without renumbering every
 * call site, which is the change that would otherwise silently reorder live queues.
 */
export const AGENT_SLA_PRIORITY: Record<AgentSlaClass, number> = {
  prospect_reply: 10,
  interactive_command: 20,
  work_order: 30,
  bulk_research: 40,
};

export function priorityForSlaClass(slaClass: AgentSlaClass): number {
  return AGENT_SLA_PRIORITY[slaClass];
}

/** True when `a` should be worked before `b`. */
export function outranks(a: AgentSlaClass, b: AgentSlaClass): boolean {
  return AGENT_SLA_PRIORITY[a] < AGENT_SLA_PRIORITY[b];
}

/**
 * Which SLA class a work order's execution belongs to.
 *
 * Work order execution is `work_order` — except a `research_batch`, which is precisely the bulk
 * work the ordering exists to keep out of the way. Encoding that here rather than at the
 * enqueue site keeps the one judgement call in the same file as the rule it follows from.
 */
export function slaClassForWorkOrderType(type: string): AgentSlaClass {
  return type === 'research_batch' || type === 'prospect_batch' ? 'bulk_research' : 'work_order';
}
