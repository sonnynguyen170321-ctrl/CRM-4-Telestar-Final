import { prisma } from '@/lib/prisma';
import { createWorkOrder } from '@/lib/workorders/service';
import type { SessionUser } from '@/lib/auth';
import { handbackProspectToAI, markReengagementEligible } from './ownership';

/**
 * The shortest real ownership loop (Phase 8d).
 *
 * ```text
 * human_managed → waiting_for_prospect → reengagement_eligible
 *                                             │
 *                                             │  explicit SDR action, never automatic
 *                                             ▼
 *                                       ai_reengagement  (a work order, pending approval)
 * ```
 *
 * ## Eligibility is deterministic and inert
 *
 * A threshold in days, measured from the last outbound touch. It produces a badge and a
 * recommendation — `markReengagementEligible` creates no sequence, no enrollment, no task and no
 * queue job (ARCHITECTURE §4.2a). Nothing in this module takes the prospect back.
 *
 * ## Handback is the SDR's
 *
 * `requestHandback` records their decision and opens a **reengagement** work order. The order is
 * where the plan is proposed and approved; only `startAIReengagement` — after that approval —
 * moves outreach back to the agent, and it refuses to reuse the prior cold sequence.
 */

/** Default silence, in days, before a human-managed prospect is flagged. */
export const DEFAULT_GHOST_THRESHOLD_DAYS = 7;

export interface EligibilityCheck {
  eligible: boolean;
  reason: string;
  /** Days of silence measured from the last outbound touch. */
  silentDays: number | null;
  thresholdDays: number;
  lastTouchAt: Date | null;
}

/** States a silence clock is meaningful in. Anywhere else, "quiet" means nothing. */
const WAITING_STATES = new Set(['human_managed', 'waiting_for_prospect']);

export async function evaluateReengagementEligibility(input: {
  tenantId: string;
  leadId: string;
  thresholdDays?: number;
  now?: Date;
}): Promise<EligibilityCheck> {
  const thresholdDays = input.thresholdDays ?? DEFAULT_GHOST_THRESHOLD_DAYS;
  const now = input.now ?? new Date();

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { tenantId: true, operatingState: true },
  });
  if (!lead || lead.tenantId !== input.tenantId) {
    return { eligible: false, reason: 'prospect_not_found', silentDays: null, thresholdDays, lastTouchAt: null };
  }
  if (lead.operatingState === 'reengagement_eligible') {
    return { eligible: true, reason: 'already_eligible', silentDays: null, thresholdDays, lastTouchAt: null };
  }
  if (!WAITING_STATES.has(lead.operatingState)) {
    return {
      eligible: false,
      reason: `not_waiting (${lead.operatingState})`,
      silentDays: null,
      thresholdDays,
      lastTouchAt: null,
    };
  }

  // The last thing *we* sent. A prospect who replied is not a ghost, and an inbound message moves
  // ownership rather than the clock.
  const lastOutbound = await prisma.outboundMessage.findFirst({
    where: { tenantId: input.tenantId, leadId: input.leadId, status: 'sent' },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  const lastInbound = await prisma.inboundMessage.findFirst({
    where: { tenantId: input.tenantId, leadId: input.leadId, isReply: true },
    orderBy: { date: 'desc' },
    select: { date: true },
  });

  const lastTouchAt = lastOutbound?.sentAt ?? null;
  if (!lastTouchAt) {
    return { eligible: false, reason: 'no_outbound_touch', silentDays: null, thresholdDays, lastTouchAt: null };
  }
  if (lastInbound && lastInbound.date > lastTouchAt) {
    return { eligible: false, reason: 'prospect_replied_last', silentDays: 0, thresholdDays, lastTouchAt };
  }

  const silentDays = Math.floor((now.getTime() - lastTouchAt.getTime()) / 86_400_000);
  return {
    eligible: silentDays >= thresholdDays,
    reason: silentDays >= thresholdDays ? 'ghost_threshold_reached' : 'still_within_threshold',
    silentDays,
    thresholdDays,
    lastTouchAt,
  };
}

/**
 * Evaluate, and mark when the threshold is reached.
 *
 * Marking is the whole action. The name is the hazard — "eligible" reads like something the system
 * should act on, and acting on it is the defect.
 */
export async function detectGhostedProspect(input: {
  tenantId: string;
  leadId: string;
  actorUserId: string;
  thresholdDays?: number;
  now?: Date;
}): Promise<EligibilityCheck & { marked: boolean }> {
  const check = await evaluateReengagementEligibility(input);
  if (!check.eligible || check.reason === 'already_eligible') {
    return { ...check, marked: false };
  }

  // The episode is the handoff that opened this human-managed stretch, so re-running detection
  // during the same silence is inert while a later episode is eligible again on its own.
  const episode = await prisma.prospectTransition.findFirst({
    where: { tenantId: input.tenantId, leadId: input.leadId, toState: 'human_attention' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  const result = await markReengagementEligible({
    leadId: input.leadId,
    tenantId: input.tenantId,
    episodeId: episode?.id ?? `lead:${input.leadId}`,
    reason: `${check.silentDays} days without a reply (threshold ${check.thresholdDays})`,
    actorUserId: input.actorUserId,
  });

  return { ...check, marked: result.applied };
}

export interface HandbackResult {
  workOrderId: string;
  state: string;
  applied: boolean;
}

/**
 * The SDR's explicit "Resume AI Follow-up".
 *
 * Opens a `reengagement` work order **first**, so the transition has a durable request to point at,
 * then records the ownership move. The work order is what carries the proposal and the approval;
 * this function starts no outreach and enrolls nobody.
 */
export async function requestHandback(
  user: SessionUser,
  input: { leadId: string; reason?: string }
): Promise<HandbackResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { tenantId: true, campaignId: true },
  });
  if (!lead || lead.tenantId !== user.tenantId) {
    throw new Error(`Prospect ${input.leadId} not found`);
  }

  const order = await createWorkOrder({
    tenantId: user.tenantId,
    type: 'reengagement',
    createdById: user.id,
    leadId: input.leadId,
    campaignId: lead.campaignId ?? null,
    // Deterministic key: a double-click resolves to the same order rather than two.
    requestKey: `reengagement:${input.leadId}`,
  });

  const transition = await handbackProspectToAI({
    leadId: input.leadId,
    tenantId: user.tenantId,
    requestId: order.id,
    actorUserId: user.id,
    reason: input.reason,
  });

  return { workOrderId: order.id, state: transition.state, applied: transition.applied };
}
