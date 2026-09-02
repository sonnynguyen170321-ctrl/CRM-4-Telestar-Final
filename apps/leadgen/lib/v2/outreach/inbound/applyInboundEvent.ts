import "server-only";

import {
  correlateInbound,
  decideInboundAction,
  type InboundHeaders,
  type InboundKind,
} from "./correlateInbound";
import { extractReplySnippet } from "../inbox/replySnippet";
import { sanitizeNullableText } from "../../persistence/jsonbSanitizer";

// OL2: the inbound APPLY runtime (closes Link B). Consumes the pure O7 logic
// (correlateInbound + decideInboundAction) and persists the effects in ONE
// tenant-scoped transaction:
//   - V2InboundMailEvent inserted idempotently (unique senderAccountId+mailboxUid)
//     => replay-safe; a duplicate poll re-processes nothing.
//   - un-correlatable / forged mail is stored UNCORRELATED and otherwise IGNORED
//     (trust-by-correlation, B3/B14) — never suppresses or halts.
//   - hard bounce  => BOUNCE suppression + halt enrollment + message BOUNCED + activity.
//   - unsubscribe  => UNSUBSCRIBE suppression + halt enrollment + activity.
//   - reply        => halt enrollment + message REPLIED + activity + workflow -> RESPONDED.
//   - soft bounce  => activity only (no permanent suppression).
// Effects attach to the correlated message's LeadAssignment (Invariant 2) — never
// a global company effect. The caller (IMAP poller) supplies our outbound
// Message-IDs (already scoped to the polled sender).

export type InboundApplyTx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type InboundApplyDb = InboundApplyTx & {
  $transaction<T>(fn: (tx: InboundApplyTx) => Promise<T>): Promise<T>;
};

export type InboundApplyInput = {
  organizationId: string;
  senderAccountId: string;
  mailboxUid: string;
  inboundMessageId?: string | null;
  headers: InboundHeaders;
  ourOutboundMessageIds: ReadonlySet<string>;
};

export type InboundApplyResult = {
  applied: boolean;
  duplicate: boolean;
  eventKind: string;
  correlatedMessageId: string | null;
  createdSuppression: boolean;
  haltedSequence: boolean;
  activityEventKind: string | null;
};

export function inboundEventKind(kind: InboundKind): string {
  switch (kind) {
    case "reply":
      return "REPLY";
    case "bounce_dsn":
      return "BOUNCE_DSN";
    case "unsubscribe":
      return "UNSUBSCRIBE";
    default:
      return "UNCORRELATED";
  }
}

type MessageLookup = {
  id: string;
  leadAssignmentId: string;
  contactId: string | null;
  enrollmentId: string | null;
  toAddress: string;
  status: string;
};

export async function applyInboundEvent(
  db: InboundApplyDb,
  input: InboundApplyInput
): Promise<InboundApplyResult> {
  const correlated = correlateInbound(input.headers, input.ourOutboundMessageIds);
  const action = decideInboundAction(correlated);
  const eventKind = inboundEventKind(correlated.kind);
  const dsnStatus = correlated.dsn?.dsnStatus ?? null;

  return db.$transaction(async (tx) => {
    // Look up the correlated outbound message (for lead linkage + effects).
    let message: MessageLookup | null = null;
    if (correlated.correlatedMessageId) {
      const rows = await tx.$queryRawUnsafe<MessageLookup[]>(
        `SELECT "id", "leadAssignmentId", "contactId", "enrollmentId", "toAddress", "status"::text AS "status"
         FROM "V2OutreachMessage"
         WHERE "organizationId" = $1 AND "providerMessageId" = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        input.organizationId,
        correlated.correlatedMessageId
      );
      message = rows[0] ?? null;
    }

    // Unibox: persist the reply body + a stripped snippet so the in-app inbox can
    // render the conversation (bounces/uncorrelated carry no body worth keeping).
    const isReply = correlated.kind === "reply";
    const bodyText = isReply ? (input.headers.rawBody || null) : null;
    const snippet = isReply && bodyText ? extractReplySnippet(bodyText) : null;

    // Idempotent insert (unique senderAccountId+mailboxUid). 0 rows => already processed.
    const inserted = await tx.$executeRawUnsafe(
      `INSERT INTO "V2InboundMailEvent"
        ("id", "organizationId", "senderAccountId", "mailboxUid", "messageId", "eventKind",
         "correlatedMessageId", "correlatedLeadAssignmentId", "dsnStatus", "fromAddress", "subject",
         "bodyText", "snippet", "processedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6::"V2InboundEventKind", $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("senderAccountId", "mailboxUid") DO NOTHING`,
      genId("inev"),
      input.organizationId,
      input.senderAccountId,
      input.mailboxUid,
      input.inboundMessageId ?? null,
      eventKind,
      correlated.correlatedMessageId,
      message?.leadAssignmentId ?? null,
      dsnStatus,
      sanitizeNullableText(input.headers.from ?? null),
      sanitizeNullableText(input.headers.subject ?? null),
      sanitizeNullableText(bodyText),
      sanitizeNullableText(snippet)
    );

    if (inserted === 0) {
      return result(false, true, eventKind, correlated.correlatedMessageId, false, false, null);
    }

    // Un-correlatable / forged mail: stored UNCORRELATED, nothing else (B3/B14).
    if (action.action === "ignore" || !message) {
      return result(true, false, eventKind, correlated.correlatedMessageId, false, false, null);
    }

    let createdSuppression = false;
    let haltedSequence = false;

    if (action.createSuppression && action.suppressionType) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "V2SuppressionEntry"
          ("id", "organizationId", "scopeType", "identifierType", "identifierValueNormalized", "suppressionType", "reason", "source", "createdAt")
         VALUES ($1, $2, 'ORGANIZATION', 'EMAIL', $3, $4::"V2SuppressionType", $5, 'inbound_apply', CURRENT_TIMESTAMP)
         ON CONFLICT DO NOTHING`,
        genId("supp"),
        input.organizationId,
        message.toAddress.toLowerCase(),
        action.suppressionType,
        action.suppressionType === "BOUNCE" ? "Inbound hard bounce (DSN)" : "Inbound unsubscribe"
      );
      createdSuppression = true;
    }

    if (action.haltSequence && message.enrollmentId) {
      const halted = await tx.$executeRawUnsafe(
        `UPDATE "V2SequenceEnrollment"
         SET "status" = 'HALTED', "haltReason" = $3, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "organizationId" = $2 AND "status" = 'ACTIVE'`,
        message.enrollmentId,
        input.organizationId,
        haltReasonFor(correlated.kind)
      );
      haltedSequence = halted > 0;
    }

    // Advance the message status for terminal inbound outcomes. Normally from SENT — but ALSO reconcile
    // a SEND_UNCONFIRMED message (A4): if a send went stale/unconfirmed after a worker crash it was
    // marked FAILED to avoid a double-send, yet a correlated reply PROVES it actually delivered (and a
    // bounce confirms the failure). Either signal must lift it out of the permanent SEND_UNCONFIRMED
    // limbo; on a reply we also clear the unconfirmed error + backfill sentAt.
    const nextStatus =
      correlated.kind === "bounce_dsn" && action.suppressionType === "BOUNCE"
        ? "BOUNCED"
        : correlated.kind === "reply"
          ? "REPLIED"
          : null;
    if (nextStatus) {
      await tx.$executeRawUnsafe(
        `UPDATE "V2OutreachMessage"
         SET "status" = $3::"V2OutreachMessageStatus",
             "errorCode" = CASE WHEN "errorCode" = 'SEND_UNCONFIRMED' THEN NULL ELSE "errorCode" END,
             "errorMessage" = CASE WHEN "errorCode" = 'SEND_UNCONFIRMED' THEN NULL ELSE "errorMessage" END,
             "sentAt" = CASE WHEN $3 = 'REPLIED' THEN COALESCE("sentAt", CURRENT_TIMESTAMP) ELSE "sentAt" END,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "organizationId" = $2
           AND ("status" = 'SENT' OR ("status" = 'FAILED' AND "errorCode" = 'SEND_UNCONFIRMED'))`,
        message.id,
        input.organizationId,
        nextStatus
      );
    }

    // Link A activity for the correlated lead.
    if (action.activityEventKind) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "V2OutreachActivity"
          ("id", "organizationId", "leadAssignmentId", "contactId", "channel", "eventKind", "occurredAt", "messageId", "metadataJson", "createdAt")
         VALUES ($1, $2, $3, $4, 'email', $5, CURRENT_TIMESTAMP, $6, $7::jsonb, CURRENT_TIMESTAMP)`,
        genId("oact"),
        input.organizationId,
        message.leadAssignmentId,
        message.contactId,
        action.activityEventKind,
        message.id,
        JSON.stringify({ correlatedMessageId: correlated.correlatedMessageId, dsnStatus })
      );
    }

    // Reply nudges workflow forward (never downgrades a later stage).
    if (correlated.kind === "reply") {
      await tx.$executeRawUnsafe(
        `UPDATE "V2LeadAssignment"
         SET "workflowStatus" = 'RESPONDED', "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "organizationId" = $2
           AND "workflowStatus" IN ('NEW', 'ASSIGNED', 'WORKING', 'CONTACTED')`,
        message.leadAssignmentId,
        input.organizationId
      );
    }

    return result(true, false, eventKind, correlated.correlatedMessageId, createdSuppression, haltedSequence, action.activityEventKind);
  });
}

function haltReasonFor(kind: InboundKind): string {
  switch (kind) {
    case "reply":
      return "replied";
    case "bounce_dsn":
      return "hard_bounced";
    case "unsubscribe":
      return "unsubscribed";
    default:
      return "inbound";
  }
}

function result(
  applied: boolean,
  duplicate: boolean,
  eventKind: string,
  correlatedMessageId: string | null,
  createdSuppression: boolean,
  haltedSequence: boolean,
  activityEventKind: string | null
): InboundApplyResult {
  return { applied, duplicate, eventKind, correlatedMessageId, createdSuppression, haltedSequence, activityEventKind };
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
