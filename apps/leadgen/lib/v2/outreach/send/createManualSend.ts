import "server-only";

import { enqueueV2Job } from "../../jobs/enqueueJob";
import type { V2JobDatabase } from "../../jobs/types";
import { buildManualSendIdempotencyKey } from "./buildOutreachMessage";

// OL5: create a manual outreach message + enqueue its EMAIL_SEND job. The message
// is inserted QUEUED and idempotent on (organizationId, idempotencyKey) so a
// double submit maps to the same row (B13). The job then runs through the send
// handler, where the SUPPRESSION GATE is the last synchronous check before the
// provider (Invariant 10) and the transport is sandbox unless the sender is
// flipped live (OL7). This function never sends directly — it only enqueues.

export type ManualSendDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type CreateManualSendInput = {
  organizationId: string;
  createdByUserId?: string | null;
  leadAssignmentId: string;
  contactId?: string | null;
  senderAccountId: string;
  toAddress: string;
  subject: string;
  body: string;
  // Unibox reply: the inbound message's own Message-ID we are answering. Stored on
  // V2OutreachMessage.inReplyToId so the send path can emit an In-Reply-To header
  // (recipient-side threading). Optional — correlation of the recipient's next
  // reply works regardless, since it matches any of our outbound providerMessageIds.
  inReplyToId?: string | null;
  // Previously-uploaded (staged) V2EmailAttachment ids to link to this message.
  attachmentIds?: string[];
  // Stable per logical send (e.g. a request id) so retries are idempotent.
  sendRequestId: string;
};

export type CreateManualSendResult = { messageId: string; enqueued: boolean };

export async function createManualSend(
  db: ManualSendDb,
  input: CreateManualSendInput
): Promise<CreateManualSendResult> {
  const idempotencyKey = buildManualSendIdempotencyKey({
    organizationId: input.organizationId,
    leadAssignmentId: input.leadAssignmentId,
    sendRequestId: input.sendRequestId,
  });
  const newId = genId("omsg");
  const unsubToken = genId("unsub");

  await db.$executeRawUnsafe(
    `INSERT INTO "V2OutreachMessage"
       ("id", "organizationId", "leadAssignmentId", "contactId", "senderAccountId",
        "idempotencyKey", "status", "toAddress", "subject", "bodyRef", "listUnsubscribeToken",
        "inReplyToId", "createdByUserId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "idempotencyKey") DO NOTHING`,
    newId,
    input.organizationId,
    input.leadAssignmentId,
    input.contactId ?? null,
    input.senderAccountId,
    idempotencyKey,
    input.toAddress,
    input.subject,
    input.body,
    unsubToken,
    input.inReplyToId ?? null,
    input.createdByUserId ?? null
  );

  // Resolve the actual message id (existing row on conflict, else the new one).
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2OutreachMessage"
     WHERE "organizationId" = $1 AND "idempotencyKey" = $2 LIMIT 1`,
    input.organizationId,
    idempotencyKey
  );
  const messageId = rows[0]?.id ?? newId;

  // Link staged attachments to this message (idempotent; only unlinked, own-org, live rows).
  const attachmentIds = Array.from(new Set((input.attachmentIds ?? []).filter(Boolean))).slice(0, 10);
  if (attachmentIds.length > 0) {
    await db.$executeRawUnsafe(
      `UPDATE "V2EmailAttachment" SET "messageId" = $1
       WHERE "organizationId" = $2 AND "id" = ANY($3::text[]) AND "messageId" IS NULL AND "deletedAt" IS NULL`,
      messageId,
      input.organizationId,
      attachmentIds
    );
  }

  const result = await enqueueV2Job(db as unknown as V2JobDatabase, {
    organizationId: input.organizationId,
    jobType: "EMAIL_SEND",
    sourceType: "MANUAL",
    sourceId: null,
    idempotencyKey: `email-send-job:${input.organizationId}:${messageId}`,
    payload: { messageId },
    createdByUserId: input.createdByUserId ?? null,
  });

  return { messageId, enqueued: result.kind === "created" || result.kind === "existing" };
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
