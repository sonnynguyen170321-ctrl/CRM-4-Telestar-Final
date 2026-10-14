import { prisma } from '@/lib/prisma';
import { dedupeKeyFor, enqueue, enqueueReschedule, removeQueuedJob } from '@/lib/bullmq/enqueue';
import type { SendTiming } from '@/lib/email/sendControls';
import { JobType, type EmailSendPayload, type EmailApplyReplyPayload, type EmailApplyBouncePayload } from '@/lib/bullmq';
import { buildIdempotencyKey, OUTBOUND_STATUS, type OutboundSendSource } from '@/lib/email/idempotency';

/**
 * Record the intent to send, exactly once.
 *
 * Every caller — sequence auto-send, ad-hoc compose, inbox reply — goes through here so
 * there is a single definition of what "the same send" means. The caller names the
 * *source* of the send; the key is derived from durable ids only (see
 * `lib/email/idempotency.ts`), never from the subject or body.
 *
 * A single `upsert` on the unique key does the deduplication. The previous
 * `findUnique`-then-`create` left a window in which two workers both saw no row and both
 * created one, so the loser died on the unique constraint after its side effects had
 * already run.
 *
 * The update branch is deliberately empty: if the row already exists, its status,
 * provider id and rendered content belong to the in-flight or completed attempt and must
 * not be overwritten by a later caller re-deriving the same intent.
 */
export async function createOutboundMessage(params: {
  source: OutboundSendSource;
  leadId: string;
  accountId: string;
  templateId?: string;
  to: string;
  /** Carbon / blind copies, already validated and de-duplicated (lib/compose/recipients.ts). */
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  tenantId: string;
  /**
   * Which A/B variant produced this wording, and which cadence step it belongs to.
   *
   * Attribution, and it belongs on the row that records the send rather than being recomputed
   * later: the selection is deterministic from the seed inputs, so recomputing would quietly
   * change the historical answer whenever those inputs, the variant set or the tie-break changed.
   * Omitted for every send with no A/B pair and for approved per-prospect copy, which overrides
   * variant selection entirely.
   */
  abVariantId?: string | null;
  sequenceId?: string | null;
  sequenceStepOrder?: number | null;
  /** The earlier message this one replies to, when the step sends in the same thread. */
  inReplyToOutboundId?: string | null;
  /** The prospect's message an inbox reply answers; the worker threads the reply under it. */
  inReplyToInboundId?: string | null;
  /** Composer send controls: the scheduled time, who wrote it, and the per-email tracking decision. */
  scheduledFor?: Date | null;
  composedById?: string | null;
  trackOpens?: boolean | null;
  trackClicks?: boolean | null;
}) {
  const idempotencyKey = buildIdempotencyKey(params.source);
  return prisma.outboundMessage.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      leadId: params.leadId,
      accountId: params.accountId,
      templateId: params.templateId,
      to: params.to,
      // Only when set, so a send with no copies writes exactly the row it always did.
      ...(params.cc?.length ? { cc: params.cc } : {}),
      ...(params.bcc?.length ? { bcc: params.bcc } : {}),
      subject: params.subject,
      body: params.body,
      // Written on create only, with the rest of the row. The empty update branch is what makes
      // a retry keep the first attempt's identity — a re-derived send must not be able to
      // re-attribute an in-flight message to a different variant.
      abVariantId: params.abVariantId ?? null,
      sequenceId: params.sequenceId ?? null,
      sequenceStepOrder: params.sequenceStepOrder ?? null,
      // Only when set, so a send that is not a reply writes exactly the row it always did.
      ...(params.inReplyToOutboundId ? { inReplyToOutboundId: params.inReplyToOutboundId } : {}),
      ...(params.inReplyToInboundId ? { inReplyToInboundId: params.inReplyToInboundId } : {}),
      // Only when set: a sequence send writes exactly the row it always did.
      ...(params.scheduledFor ? { scheduledFor: params.scheduledFor } : {}),
      ...(params.composedById ? { composedById: params.composedById } : {}),
      ...(params.trackOpens != null ? { trackOpens: params.trackOpens } : {}),
      ...(params.trackClicks != null ? { trackClicks: params.trackClicks } : {}),
      idempotencyKey,
      status: OUTBOUND_STATUS.PENDING,
      tenantId: params.tenantId,
    },
  });
}

export async function enqueueEmailSendWorkflow(
  payload: EmailSendPayload,
  tenantId: string
): Promise<string> {
  return enqueue(JobType.EMAIL_SEND, payload, { tenantId });
}

/** The job payload for a stored message. One definition, so a cancel finds the job the send queued. */
export function emailSendPayloadFor(row: {
  id: string;
  accountId: string;
  to: string;
  subject: string | null;
  body: string | null;
  leadId: string;
  templateId: string | null;
}): EmailSendPayload {
  return {
    outboundMessageId: row.id,
    accountId: row.accountId,
    to: row.to,
    subject: row.subject ?? '',
    body: row.body ?? '',
    leadId: row.leadId,
    ...(row.templateId ? { templateId: row.templateId } : {}),
  };
}

const scheduledDiscriminator = (at: Date) => `sched:${at.toISOString()}`;

/**
 * Queue a composed message according to its timing: straight away, after the undo window, or at
 * the scheduled time. The worker re-checks `scheduledFor` and the status, so the queue timing is
 * an optimisation of when to wake, never the thing that decides whether to send.
 */
export async function enqueueTimedEmailSend(
  payload: EmailSendPayload,
  tenantId: string,
  timing: SendTiming,
): Promise<string> {
  if (timing.kind === 'scheduled') {
    return enqueueReschedule(JobType.EMAIL_SEND, payload, {
      tenantId,
      delay: timing.delayMs,
      discriminator: scheduledDiscriminator(timing.scheduledFor),
    });
  }
  if (timing.kind === 'undo') {
    return enqueue(JobType.EMAIL_SEND, payload, { tenantId, delay: timing.delayMs });
  }
  return enqueueEmailSendWorkflow(payload, tenantId);
}

/**
 * Take a composed message's waiting job off the queue (undo, cancel, reschedule). Tries the key of
 * the undo / immediate job and the key of the scheduled job for the time it was scheduled for.
 * Best effort: the status compare-and-set in the cancel route is what stops the send.
 */
export async function removeTimedEmailSend(
  payload: EmailSendPayload,
  tenantId: string,
  scheduledFor: Date | null,
): Promise<void> {
  const record = payload as unknown as Record<string, unknown>;
  const keys = [dedupeKeyFor(JobType.EMAIL_SEND, tenantId, record)];
  if (scheduledFor) keys.push(dedupeKeyFor(JobType.EMAIL_SEND, tenantId, record, scheduledDiscriminator(scheduledFor)));
  for (const key of keys) {
    try {
      await removeQueuedJob(JobType.EMAIL_SEND, tenantId, key);
    } catch (err) {
      console.warn('[email] could not remove the queued send job:', err);
    }
  }
}

export async function enqueueEmailSyncWorkflow(
  accountId: string,
  tenantId: string
): Promise<string> {
  return enqueue(JobType.EMAIL_SYNC, { accountId }, { tenantId });
}

export async function enqueueEmailApplyReplyWorkflow(
  payload: EmailApplyReplyPayload,
  tenantId: string
): Promise<string> {
  return enqueue(JobType.EMAIL_APPLY_REPLY, payload, { tenantId });
}

export async function enqueueEmailApplyBounceWorkflow(
  payload: EmailApplyBouncePayload,
  tenantId: string
): Promise<string> {
  return enqueue(JobType.EMAIL_APPLY_BOUNCE, payload, { tenantId });
}
