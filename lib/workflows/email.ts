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
