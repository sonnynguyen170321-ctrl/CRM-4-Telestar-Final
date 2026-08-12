import { prisma } from '@/lib/prisma';
import { applyTransition, type TransitionResult } from './transitions';

/**
 * The four ownership transitions (Revenue AI Phase 3).
 *
 * Ownership changes hands twice per prospect and only one direction is automatic: a meaningful
 * reply moves a lead to the SDR by itself; **only the SDR moves it back**. See
 * docs/revenue-ai/ARCHITECTURE.md §4a.
 *
 * Each service owns every consequence of its transition — state, ledger, activity, task,
 * notification — so a caller cannot half-apply one by forgetting a step. None of them writes
 * `Lead.operatingState` directly; that belongs to `applyTransition`.
 */

export interface HandoffInput {
  leadId: string;
  tenantId: string;
  /**
   * The durable id of the event that caused the handoff — the inbound activity or provider
   * message. Keys the idempotency ledger, so redelivering the same reply is inert while a
   * genuinely new reply later is a new handoff.
   */
  eventId: string;
  /** Why a human is needed. Shown to the SDR, stored on the activity. */
  reason: string;
  /** Free-text summary of the prospect's message, for the task the SDR picks up. */
  summary?: string;
}

/**
 * `ai_managed` → `human_attention`. Automatic: meaningful engagement may hand off without a
 * human deciding to.
 *
 * Deliberately does **not** pause the sequence or re-interpret sequence state. The caller
 * resolves the authoritative enrollment once and pauses; a second interpretation in here would
 * be a competing source of truth for the same question.
 */
export async function handoffProspectToHuman(input: HandoffInput): Promise<TransitionResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, firstName: true, lastName: true, company: true, assignedToId: true },
  });
  if (!lead) throw new Error(`Prospect ${input.leadId} not found`);

  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: { kind: 'handoff', leadId: input.leadId, eventId: input.eventId },
    toState: 'human_attention',
    // No `fromStates` guard: a prospect can reply from any operating state, including one the
    // CRM never moved out of `unassigned`. Refusing the handoff because the state machine did
    // not expect it would drop a real reply, which is the worst outcome available here.
    activityType: 'prospect_handed_off',
    activityDescription: `Handed to ${lead.firstName} ${lead.lastName}'s SDR — ${input.reason}`,
    activityMetadata: { reason: input.reason },
    actorUserId: lead.assignedToId,
    systemInitiated: true,
    // Each consequence is claimed separately, so a resume after a crash mid-handoff creates the
    // notification without creating a second task.
    onApplied: async ({ runEffect }) => {
      await runEffect('task', async () => {
        await prisma.task.create({
          data: {
            leadId: input.leadId,
            userId: lead.assignedToId,
            type: 'manual',
            title: `Handle reply from ${lead.firstName} ${lead.lastName}`,
            description: input.summary ?? `Replied to your outreach. Respond while it's warm.`,
            dueDate: new Date(),
            priority: 'high',
          },
        });
      });

      await runEffect('notification', async () => {
        await prisma.notification.create({
          data: {
            userId: lead.assignedToId,
            type: 'lead_replied',
            title: 'Lead Replied!',
            text: `${lead.firstName} ${lead.lastName} (${lead.company}) replied — ${input.reason}`,
            linkTo: `/leads/${input.leadId}`,
          },
        });
      });
    },
  });
}

export interface StopProspectInput {
  leadId: string;
  tenantId: string;
  /** The inbound event that caused the stop. Keys idempotency, so redelivery is inert. */
  eventId: string;
  reason: string;
}

/**
 * Any AI-owned state → `completed`. The prospect asked to be left alone (Phase 8b, class A).
 *
 * Deliberately creates **no task and no notification**. An unsubscribe is not an opportunity, and
 * interrupting an SDR to announce one teaches them to skim the same queue that carries pricing
 * questions. The activity and the state change are the whole record.
 */
export async function stopProspectOutreach(input: StopProspectInput): Promise<TransitionResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { assignedToId: true },
  });
  if (!lead) throw new Error(`Prospect ${input.leadId} not found`);

  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: { kind: 'handoff', leadId: input.leadId, eventId: `stop:${input.eventId}` },
    toState: 'completed',
    // No `fromStates`: a stop is valid from wherever the prospect happens to be, including states
    // the CRM never moved them out of. Refusing one would keep contacting someone who said no.
    activityType: 'prospect_handed_off',
    activityDescription: `Outreach stopped — ${input.reason}`,
    activityMetadata: { reason: input.reason, stopped: true },
    actorUserId: lead.assignedToId,
    systemInitiated: true,
  });
}

export interface ReengagementEligibleInput {
  leadId: string;
  tenantId: string;
  /**
   * The handoff that opened this human-managed episode. Re-running ghost detection during the
   * same silence is inert; a later episode, after a handback and a second handoff, is eligible
   * again on its own.
   */
  episodeId: string;
  /** Which playbook threshold was reached, for the timeline. */
  reason: string;
  actorUserId: string;
}

/**
 * `waiting_for_prospect` → `reengagement_eligible`. **Inert by design.**
 *
 * It marks and it explains. It creates no sequence, no enrollment, no task, no outbound
 * message and no queue job. The name is the hazard — "eligible" reads like something the
 * system should act on, and acting on it is the defect. Only an explicit SDR handback moves a
 * prospect back toward AI outreach.
 */
export async function markReengagementEligible(
  input: ReengagementEligibleInput
): Promise<TransitionResult> {
  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: {
      kind: 'reengagement_eligible',
      leadId: input.leadId,
      episodeId: input.episodeId,
    },
    toState: 'reengagement_eligible',
    fromStates: ['human_managed', 'waiting_for_prospect'],
    activityType: 'prospect_reengagement_eligible',
    activityDescription: `Eligible for re-engagement — ${input.reason}`,
    activityMetadata: { reason: input.reason, recommendationOnly: true },
    actorUserId: input.actorUserId,
    systemInitiated: true,
    // No onApplied. Anything here would be an action, and this transition takes none.
  });
}

export interface HandbackInput {
  leadId: string;
  tenantId: string;
  /** The SDR's request. Becomes a work order id in Phase 6. */
  requestId: string;
  /** The SDR performing the handback. Never a system actor — this transition is theirs. */
  actorUserId: string;
  reason?: string;
}

/**
 * `reengagement_eligible` / `human_managed` → `ai_reengagement`, pending approval.
 *
 * The only way out of human ownership. It records the SDR's intent and moves the prospect into
 * `ai_reengagement`; it does **not** start outreach. `startAIReengagement` does that, once a
 * plan is approved.
 */
export async function handbackProspectToAI(input: HandbackInput): Promise<TransitionResult> {
  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: { kind: 'handback', leadId: input.leadId, requestId: input.requestId },
    toState: 'ai_reengagement',
    // Only from a human-owned state. A prospect already under AI cannot be handed back, and
    // silently accepting that would hide a double-submit or a confused caller.
    fromStates: ['human_managed', 'human_attention', 'reengagement_eligible', 'waiting_for_prospect'],
    activityType: 'prospect_handed_back',
    activityDescription: `SDR handed the prospect back to AI${input.reason ? ` — ${input.reason}` : ''}`,
    activityMetadata: { requestId: input.requestId, reason: input.reason ?? null },
    actorUserId: input.actorUserId,
    workOrderId: input.requestId,
  });
}

export interface StartReengagementInput {
  leadId: string;
  tenantId: string;
  /** The approved re-engagement work order. */
  workOrderId: string;
  actorUserId: string;
  /**
   * The sequence the approved plan built from the actual conversation. Never the prospect's
   * original cold sequence — see the check below.
   */
  reengagementSequenceId: string;
  /** The cold sequence this prospect previously ran, if any. */
  priorSequenceId?: string | null;
}

export class ColdSequenceRestartError extends Error {
  constructor(readonly leadId: string, readonly sequenceId: string) {
    super(
      `Re-engagement for prospect ${leadId} may not reuse the prior cold sequence ${sequenceId}`
    );
    this.name = 'ColdSequenceRestartError';
  }
}

/**
 * `ai_reengagement` → `ai_managed`, with an approved plan.
 *
 * Refuses to reuse the prospect's prior cold sequence. Re-engagement is built from the
 * conversation that actually happened — the interest shown, the objection raised, the question
 * left unanswered. Restarting the original cadence would send "just following up" to someone
 * who already told you something, which is a failure of the feature rather than an edge case.
 */
export async function startAIReengagement(
  input: StartReengagementInput
): Promise<TransitionResult> {
  if (input.priorSequenceId && input.priorSequenceId === input.reengagementSequenceId) {
    throw new ColdSequenceRestartError(input.leadId, input.reengagementSequenceId);
  }

  return applyTransition({
    leadId: input.leadId,
    tenantId: input.tenantId,
    occurrence: {
      kind: 'ai_reengagement_started',
      leadId: input.leadId,
      workOrderId: input.workOrderId,
    },
    toState: 'ai_managed',
    fromStates: ['ai_reengagement'],
    activityType: 'prospect_ai_reengagement_started',
    activityDescription: 'AI re-engagement started from an approved follow-up plan',
    activityMetadata: {
      workOrderId: input.workOrderId,
      sequenceId: input.reengagementSequenceId,
      priorSequenceId: input.priorSequenceId ?? null,
    },
    actorUserId: input.actorUserId,
    workOrderId: input.workOrderId,
  });
}
