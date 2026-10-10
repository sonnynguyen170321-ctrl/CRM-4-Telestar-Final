import 'server-only';

import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { appendOutcomeTag, applyOutcomeEffects, callbackDueDate } from './outcomeEffects';
import { getPhoneOutcome, type PhoneOutcomeId } from './outcomes';

/**
 * The softphone's wrap-up (docs/dialer/TASKS.md D5.3): the rep says what happened on a call they
 * placed. The browser never writes call history — status, timings and the `call_made` activity come
 * from verified provider events — so this only labels the rep's own call, and applies what the
 * outcome means for the lead (do-not-call flags and suppression, queue tag, callback task).
 */

/** How long after the attempt a rep may still label a call (a tab closed mid-call can come back to it). */
export const OUTCOME_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RecordCallOutcomeResult =
  | { ok: true; callId: string; outcome: PhoneOutcomeId; suppressed: boolean }
  /** `not_found` covers a missing call, another tenant's call and another rep's call: indistinguishable on purpose. */
  | { ok: false; reason: 'not_found' | 'call_not_started' | 'window_closed' };

export async function recordCallOutcome(params: {
  user: SessionUser & { tenantId: string };
  callId: string;
  outcome: PhoneOutcomeId;
  notes: string;
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

  const lead = call.leadId
    ? await prisma.lead.findFirst({
        where: { id: call.leadId, tenantId, archivedAt: null },
        select: { id: true, firstName: true, lastName: true, assignedToId: true, contactId: true, timezone: true },
      })
    : null;
  // A repeat of the same callback outcome must not queue a second task.
  const repeatsCallback = call.outcome === 'callback_requested' && definition.callOutcome === 'callback_requested';
  const dueDate = lead && !repeatsCallback ? await callbackDueDate(outcome, lead, user.id, now) : null;

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
      now,
    });
    return effects.suppressed;
  });

  if (lead) await appendOutcomeTag(tenantId, lead.id, outcome);

  return { ok: true, callId: call.id, outcome, suppressed };
}
