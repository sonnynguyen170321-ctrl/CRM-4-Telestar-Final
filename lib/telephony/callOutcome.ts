import 'server-only';

import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { appendOutcomeTag, applyOutcomeEffects, callbackDueDate, callbackTaskExists } from './outcomeEffects';
import { getPhoneOutcome, type PhoneOutcomeId } from './outcomes';

/**
 * The softphone's wrap-up (docs/dialer/TASKS.md D5.3): the rep says what happened on a call they
 * placed. The browser never writes call history — status, timings and the `call_made` activity come
 * from verified provider events — so this only labels the rep's own call, and applies what the
 * outcome means for the lead (do-not-call flags and suppression, queue tag, callback task).
 */

/** How long after the attempt a rep may still label a call (a tab closed mid-call can come back to it). */
export const OUTCOME_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Calls that ended without the rep saying what happened: the wrap-up was lost (tab closed, drawer left). */
const FINAL_STATUSES = ['completed', 'no_answer', 'busy', 'failed', 'missed', 'canceled'] as const;

export async function listPendingOutcomes(params: { tenantId: string; userId: string; leadId?: string; now?: Date }) {
  const now = params.now ?? new Date();
  const rows = await prisma.call.findMany({
    where: {
      tenantId: params.tenantId,
      userId: params.userId,
      direction: 'outbound',
      outcome: null,
      status: { in: [...FINAL_STATUSES] },
      createdAt: { gt: new Date(now.getTime() - OUTCOME_WINDOW_MS) },
      ...(params.leadId ? { leadId: params.leadId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, leadId: true, toE164: true, createdAt: true, lead: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    leadId: row.leadId,
    leadName: row.lead ? `${row.lead.firstName} ${row.lead.lastName}`.trim() : null,
    toE164: row.toE164,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type RecordCallOutcomeResult =
  | { ok: true; callId: string; outcome: PhoneOutcomeId; suppressed: boolean }
  /** `not_found` covers a missing call, another tenant's call and another rep's call: indistinguishable on purpose. */
  | { ok: false; reason: 'not_found' | 'call_not_started' | 'window_closed' };

export async function recordCallOutcome(params: {
  user: SessionUser & { tenantId: string };
  callId: string;
  outcome: PhoneOutcomeId;
  notes: string;
  /** Whether the rep may still work this lead (`canAccessLead`); if not, only the call is labelled. */
  canAccess: (lead: { assignedToId: string | null; campaignId: string | null }) => Promise<boolean>;
  now?: Date;
}): Promise<RecordCallOutcomeResult> {
  const { user, callId, outcome, notes } = params;
  const tenantId = user.tenantId;
  const now = params.now ?? new Date();
  const definition = getPhoneOutcome(outcome);
  if (!definition) throw new Error(`Unknown phone outcome: ${outcome}`);

  const call = await prisma.call.findFirst({
    where: { id: callId, tenantId, userId: user.id, direction: 'outbound' },
    select: { id: true, status: true, outcome: true, toE164: true, leadId: true, createdAt: true },
  });
  if (!call) return { ok: false, reason: 'not_found' };
  // `authorized` and `blocked` never reached the provider: there is no call to label.
  if (call.status === 'authorized' || call.status === 'blocked') return { ok: false, reason: 'call_not_started' };
  if (now.getTime() - call.createdAt.getTime() > OUTCOME_WINDOW_MS) return { ok: false, reason: 'window_closed' };

  const found = call.leadId
    ? await prisma.lead.findFirst({
        where: { id: call.leadId, tenantId, archivedAt: null },
        select: { id: true, firstName: true, lastName: true, assignedToId: true, campaignId: true, contactId: true, timezone: true },
      })
    : null;
  // The call is the rep's own, but the lead may have been reassigned since: the label is still saved,
  // the effects on a lead they can no longer work are not applied.
  const lead = found && (await params.canAccess(found)) ? found : null;
  // Re-labelling is allowed, but a call makes at most one callback task however often it flips to
  // and from "callback requested", and the last-contacted date moves only for the first outcome.
  const hasTask = lead && definition.leadEffect === 'callback' ? await callbackTaskExists(tenantId, lead.id, call.id) : false;
  const dueDate = lead && !hasTask ? await callbackDueDate(outcome, lead, user.id, now) : null;

  const suppressed = await prisma.$transaction(async (tx) => {
    await tx.call.updateMany({
      where: { id: call.id, tenantId, userId: user.id },
      data: { outcome: definition.callOutcome, notes: notes || null },
    });
    if (!lead) return false;
    const effects = await applyOutcomeEffects(tx, {
      tenantId,
      userId: user.id,
      outcome,
      lead,
      e164: call.toE164,
      notes,
      dueDate,
      suppressionNote: `softphone call ${call.id}`,
      firstWrite: call.outcome === null,
      callId: call.id,
      now,
    });
    return effects.suppressed;
  });

  if (lead) await appendOutcomeTag(tenantId, lead.id, outcome);

  return { ok: true, callId: call.id, outcome, suppressed };
}
