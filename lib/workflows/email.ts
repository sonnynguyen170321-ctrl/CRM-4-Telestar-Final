import { prisma } from '@/lib/prisma';
import { enqueue } from '@/lib/bullmq/enqueue';
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
      subject: params.subject,
      body: params.body,
      // Written on create only, with the rest of the row. The empty update branch is what makes
      // a retry keep the first attempt's identity — a re-derived send must not be able to
      // re-attribute an in-flight message to a different variant.
      abVariantId: params.abVariantId ?? null,
      sequenceId: params.sequenceId ?? null,
      sequenceStepOrder: params.sequenceStepOrder ?? null,
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
