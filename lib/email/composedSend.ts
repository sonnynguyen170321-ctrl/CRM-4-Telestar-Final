/**
 * What happens to a composed message around the moment it is sent: the options the routes accept
 * (schedule, undo window, tracking), taking it back (cancel / undo), moving its time, the status the
 * composer follows, and clearing the draft it came from. Shared by the one-off send, the inbox reply
 * and the control routes so they cannot drift apart.
 *
 * The database row is the authority. The queue is told, best effort; every transition here is a
 * single-statement compare-and-set on `status = pending`, so racing a worker's claim has exactly one
 * winner and a repeated call is harmless.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';
import { resolveSendTiming, type SendTiming } from '@/lib/email/sendControls';
import { describeDelivery } from '@/lib/inbox/deliveryStatus';
import { emailSendPayloadFor, enqueueTimedEmailSend, removeTimedEmailSend } from '@/lib/workflows/email';

export interface ComposerSendOptions {
  timing: SendTiming;
  trackOpens: boolean;
  trackClicks: boolean;
}

/** The timing and tracking a send was asked for; tracking not named takes the tenant default. */
export async function resolveComposerSendOptions(
  tenantId: string,
  input: { scheduledFor?: string; delaySeconds?: number; trackOpens?: boolean; trackClicks?: boolean },
): Promise<{ ok: true; value: ComposerSendOptions } | { ok: false; response: NextResponse }> {
  const timing = resolveSendTiming({ scheduledFor: input.scheduledFor, delaySeconds: input.delaySeconds });
  if (!timing.ok) return { ok: false, response: NextResponse.json({ error: timing.error, code: 'bad_schedule' }, { status: 400 }) };
  let { trackOpens, trackClicks } = input;
  if (trackOpens === undefined || trackClicks === undefined) {
    const defaults = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { defaultTrackOpens: true, defaultTrackClicks: true } });
    trackOpens ??= defaults?.defaultTrackOpens ?? false;
    trackClicks ??= defaults?.defaultTrackClicks ?? false;
  }
  return { ok: true, value: { timing: timing.timing, trackOpens, trackClicks } };
}

/**
 * A cancelled message written again (the rep undid a send, fixed the draft and sent it once more,
 * under the same idempotency key). Back to `pending` with the new content, by compare-and-set; null
 * when it is not the caller's cancelled message.
 */
export async function reviveCancelled(
  tenantId: string,
  userId: string,
  outboundMessageId: string,
  data: { subject: string; body: string; cc: string[]; bcc: string[]; scheduledFor: Date | null; trackOpens: boolean; trackClicks: boolean },
) {
  const result = await prisma.outboundMessage.updateMany({
    where: { id: outboundMessageId, tenantId, status: OUTBOUND_STATUS.CANCELLED, composedById: userId },
    data: { ...data, status: OUTBOUND_STATUS.PENDING, cancelledAt: null, errorMessage: null },
  });
  if (result.count !== 1) return null;
  return prisma.outboundMessage.findFirst({ where: { id: outboundMessageId, tenantId } });
}

export type ManageResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string; code: string };

async function loadComposed(user: SessionUser, id: string) {
  if (!user.tenantId) return null;
  const row = await prisma.outboundMessage.findFirst({ where: { id, tenantId: user.tenantId } });
  // Not found, not forbidden: a message that is not yours does not exist as far as you can tell.
  if (!row || !row.composedById || row.sequenceId) return null;
  // Author only: a manager who can open the lead still cannot take back a colleague's email.
  return row.composedById === user.id ? row : null;
}

const NOT_FOUND = { ok: false as const, status: 404, error: 'Message not found', code: 'not_found' };

/** Undo / cancel. Idempotent: cancelling a cancelled message is a success. */
export async function cancelComposed(user: SessionUser, id: string): Promise<ManageResult<{ status: string }>> {
  const row = await loadComposed(user, id);
  if (!row) return NOT_FOUND;
  const tenantId = row.tenantId;
  const claimed = await prisma.outboundMessage.updateMany({
    where: { id, tenantId, status: OUTBOUND_STATUS.PENDING },
    data: { status: OUTBOUND_STATUS.CANCELLED, cancelledAt: new Date(), errorMessage: null },
  });
  if (claimed.count === 1) {
    await removeTimedEmailSend(emailSendPayloadFor(row), tenantId, row.scheduledFor);
    // Uploads go back to the rep, so the draft they restore still has its files; pasted images
    // are re-extracted from the body on the next send.
    await prisma.attachment.updateMany({ where: { tenantId, outboundMessageId: id, cid: null }, data: { outboundMessageId: null } });
    await prisma.attachment.deleteMany({ where: { tenantId, outboundMessageId: id, cid: { not: null } } });
    return { ok: true, status: OUTBOUND_STATUS.CANCELLED };
  }
  const now = await prisma.outboundMessage.findFirst({ where: { id, tenantId }, select: { status: true } });
  if (now?.status === OUTBOUND_STATUS.CANCELLED) return { ok: true, status: OUTBOUND_STATUS.CANCELLED };
  return {
    ok: false,
    status: 409,
    code: 'too_late',
    error: now?.status === OUTBOUND_STATUS.SENT ? 'It has already been sent.' : 'It is already being sent, so it can no longer be taken back.',
  };
}

/** Move a waiting message to a new time. */
export async function rescheduleComposed(user: SessionUser, id: string, scheduledFor: string): Promise<ManageResult<{ scheduledFor: Date }>> {
  const row = await loadComposed(user, id);
  if (!row) return NOT_FOUND;
  const timing = resolveSendTiming({ scheduledFor });
  if (!timing.ok || timing.timing.kind !== 'scheduled') {
    return { ok: false, status: 400, code: 'bad_schedule', error: timing.ok ? 'Pick a send time' : timing.error };
  }
  const moved = await prisma.outboundMessage.updateMany({
    where: { id, tenantId: row.tenantId, status: OUTBOUND_STATUS.PENDING },
    data: { scheduledFor: timing.timing.scheduledFor, errorMessage: null },
  });
  if (moved.count !== 1) return { ok: false, status: 409, code: 'too_late', error: 'It is no longer waiting to be sent.' };
  // The new job first, the old one after: a failure must never leave a pending row with no job.
  const payload = emailSendPayloadFor(row);
  try {
    await enqueueTimedEmailSend(payload, row.tenantId, timing.timing);
  } catch (err) {
    console.error('[compose] could not queue the new send time, keeping the old one:', err);
    await prisma.outboundMessage.updateMany({
      where: { id, tenantId: row.tenantId, status: OUTBOUND_STATUS.PENDING, scheduledFor: timing.timing.scheduledFor },
      data: { scheduledFor: row.scheduledFor },
    });
    return { ok: false, status: 500, code: 'queue_failed', error: 'The new time could not be saved. The email keeps its old time.' };
  }
  if (row.scheduledFor?.getTime() !== timing.timing.scheduledFor.getTime()) {
    await removeTimedEmailSend(payload, row.tenantId, row.scheduledFor);
  }
  return { ok: true, scheduledFor: timing.timing.scheduledFor };
}

export type OutboundPhase = 'scheduled' | 'queued' | 'deferred' | 'sending' | 'sent' | 'failed' | 'cancelled';

/** What the composer's toast says, from the stored row. */
export function outboundPhase(status: string, errorMessage: string | null, scheduledFor: Date | null, now: Date = new Date()): OutboundPhase {
  if (status === OUTBOUND_STATUS.SENT) return 'sent';
  if (status === OUTBOUND_STATUS.CANCELLED) return 'cancelled';
  if (status === OUTBOUND_STATUS.SENDING || status === OUTBOUND_STATUS.RECONCILIATION_REQUIRED) return 'sending';
  if (status === OUTBOUND_STATUS.PENDING) {
    if (/deferred to/i.test(errorMessage ?? '')) return 'deferred';
    return scheduledFor && scheduledFor.getTime() > now.getTime() ? 'scheduled' : 'queued';
  }
  return 'failed';
}

/** The slim status of the caller's own message; null when it is not theirs. */
export async function composedStatus(user: SessionUser, id: string) {
  if (!user.tenantId) return null;
  const row = await prisma.outboundMessage.findFirst({
    where: { id, tenantId: user.tenantId, composedById: user.id },
    select: { status: true, errorMessage: true, scheduledFor: true, sentAt: true },
  });
  if (!row) return null;
  const phase = outboundPhase(row.status, row.errorMessage, row.scheduledFor);
  const shown = describeDelivery(row.status, row.errorMessage, row.scheduledFor);
  return {
    status: row.status,
    phase,
    label: shown?.label ?? row.status,
    // Plain words only (describeDelivery): the raw errorMessage can carry a provider's answer.
    detail: row.status === OUTBOUND_STATUS.SENT ? null : shown?.detail ?? null,
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt,
    final: phase === 'sent' || phase === 'failed' || phase === 'cancelled',
  };
}

/** Delete the caller's draft for one place once its email has been queued. Never throws. */
export async function clearDraft(tenantId: string, userId: string, scopeKey: string): Promise<void> {
  try {
    await prisma.emailDraft.deleteMany({ where: { tenantId, userId, scopeKey } });
  } catch (err) {
    console.warn('[compose] could not clear the draft after sending:', err);
  }
}
