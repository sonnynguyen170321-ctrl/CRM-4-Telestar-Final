/**
 * Idempotency keys for prospect ownership transitions (Revenue AI Phase 3).
 *
 * The key identifies **one occurrence**, never just the lead and the kind. A prospect
 * legitimately moves AI → human → AI → human over a lifetime, so `handoff:lead:X` would let
 * the first handoff permanently block every later one — the transition would silently no-op
 * and the SDR would never be told about the second real reply.
 *
 * So every key carries a durable event identifier:
 *
 *   handoff                  the inbound activity that caused it
 *   reengagement_eligible    the handoff that opened this human-managed episode
 *   handback                 the SDR's request (a work order id once Phase 6 exists)
 *   ai_reengagement_started  the approved re-engagement work order
 *
 * Same discipline as `lib/email/idempotency.ts`: durable identifiers only, never mutable
 * content, and every key prefixed by its kind so two sources cannot collide.
 */

export type TransitionKind =
  | 'handoff'
  | 'reengagement_eligible'
  | 'handback'
  | 'ai_reengagement_started'
  | 'research_started'
  | 'ready_for_outreach'
  | 'ai_managed_started';

export type TransitionOccurrence =
  /**
   * A meaningful inbound message moved the prospect to the SDR. `eventId` is the durable id
   * of the thing that caused it — the inbound activity or provider message. Retrying the same
   * inbound event is a no-op; a genuinely new reply later is a new occurrence.
   */
  | { kind: 'handoff'; leadId: string; eventId: string }
  /**
   * A human-managed episode went quiet past the playbook threshold. Keyed on the handoff that
   * opened the episode, so re-running ghost detection during the same silence is inert while a
   * *later* episode — after a handback and a second handoff — is eligible again on its own.
   */
  | { kind: 'reengagement_eligible'; leadId: string; episodeId: string }
  /** The SDR asked for the lead to go back to AI. `requestId` is the work order once one exists. */
  | { kind: 'handback'; leadId: string; requestId: string }
  /** An approved re-engagement plan was activated. */
  | { kind: 'ai_reengagement_started'; leadId: string; workOrderId: string }
  /**
   * The AI-managed prospecting transitions (Phase 8a), all keyed on the **work order** that
   * caused them. A retried work order step re-enters the same occurrence and is inert; a
   * genuinely new order researching the same lead later is its own occurrence.
   */
  | { kind: 'research_started'; leadId: string; workOrderId: string }
  | { kind: 'ready_for_outreach'; leadId: string; workOrderId: string }
  | { kind: 'ai_managed_started'; leadId: string; workOrderId: string };

/**
 * Build the durable key.
 *
 * Throws on an empty component rather than emitting `handoff:lead:abc:event:` — a key with a
 * missing part collides with every other caller that made the same mistake, which is the
 * failure mode that turns an idempotency guard into a silent data-loss bug.
 */
export function buildTransitionKey(occurrence: TransitionOccurrence): string {
  switch (occurrence.kind) {
    case 'handoff':
      return join('handoff', occurrence.leadId, 'event', occurrence.eventId);
    case 'reengagement_eligible':
      return join('reengage-eligible', occurrence.leadId, 'episode', occurrence.episodeId);
    case 'handback':
      return join('handback', occurrence.leadId, 'request', occurrence.requestId);
    case 'ai_reengagement_started':
      return join('reengage-start', occurrence.leadId, 'workorder', occurrence.workOrderId);
    case 'research_started':
      return join('research-started', occurrence.leadId, 'workorder', occurrence.workOrderId);
    case 'ready_for_outreach':
      return join('ready-for-outreach', occurrence.leadId, 'workorder', occurrence.workOrderId);
    case 'ai_managed_started':
      return join('ai-managed', occurrence.leadId, 'workorder', occurrence.workOrderId);
  }
}

function join(prefix: string, leadId: string, label: string, eventId: string): string {
  if (!leadId?.trim()) throw new Error(`Transition key for ${prefix} is missing a leadId`);
  if (!eventId?.trim()) throw new Error(`Transition key for ${prefix} is missing its ${label} id`);
  return `${prefix}:lead:${leadId}:${label}:${eventId}`;
}
