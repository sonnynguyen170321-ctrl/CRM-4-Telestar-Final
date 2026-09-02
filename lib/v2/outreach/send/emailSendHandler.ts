import { createNonRetryableJobError } from "../../jobs/errors";
import type { V2JobHandler } from "../../jobs/types";
import type { ProviderInterface } from "../providers/index";
import { SandboxProvider, executeSend } from "../providers/index";
import { createSenderSmtpAdapter } from "../providers/smtpTransport";
import { isKillSwitchEngaged } from "../limits/liveSendGuards";
import type { LoadSuppressionCandidates } from "../suppression/index";
import { SuppressedError } from "../suppression/index";
import { buildProviderRequest } from "./buildOutreachMessage";
import { loadMessageAttachments } from "../attachments/storage";
import { generateMessageId } from "./messageId";
import { applySendResult, decideSendAction } from "./sendStateMachine";
import { getTrackingSecret, signTrackingToken } from "../tracking/trackingToken";
import { rewriteBodyForTracking } from "../tracking/rewriteLinksForTracking";

// O4: EMAIL_SEND job handler. Send state machine (B2), suppression gate before the
// provider (B5 via executeSend), Message-ID minted at SENDING (B2/B3), Link A
// outreach activity (B7), sync hard-bounce -> suppression (Link B). Sandbox
// provider by default (live is O9). Uses the job's tenant-scoped raw db.

type MessageRow = {
  id: string;
  organizationId: string;
  leadAssignmentId: string;
  contactId: string | null;
  senderAccountId: string;
  enrollmentId: string | null;
  status: string;
  providerMessageId: string | null;
  sendingAt: Date | null;
  toAddress: string;
  subject: string | null;
  bodyRef: string | null;
  listUnsubscribeToken: string | null;
  inReplyToId: string | null;
};

type SenderRow = {
  fromAddress: string;
  fromName: string | null;
  domain: string;
  returnPathAddress: string | null;
  liveSendEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpAuthEnc: unknown;
  trackingDomainId: string | null;
};

let defaultProvider: ProviderInterface = new SandboxProvider();
/** Default provider for non-live senders / tests (sandbox unless injected). */
export function setOutreachProvider(provider: ProviderInterface): void {
  defaultProvider = provider;
}

// OL1: choose the transport for THIS send. A real SMTP transport is used only
// when the sender is flipped live (OL7) AND the kill switch is off; credential
// decryption failures (e.g. missing master key) fail CLOSED to the default
// (sandbox) provider so a misconfig never silently degrades to an un-gated send.
// Non-live senders keep the default provider (sandbox/injected). The suppression
// gate (executeSend) runs regardless of transport.
function resolveSendProvider(sender: SenderRow): ProviderInterface {
  if (!sender.liveSendEnabled || isKillSwitchEngaged()) {
    return defaultProvider;
  }
  try {
    return createSenderSmtpAdapter({
      liveSendEnabled: sender.liveSendEnabled,
      smtpHost: sender.smtpHost,
      smtpPort: sender.smtpPort,
      smtpSecure: sender.smtpSecure,
      smtpAuthEnc: sender.smtpAuthEnc,
    });
  } catch {
    return defaultProvider;
  }
}

export const emailSendJobHandler: V2JobHandler = async (context) => {
  if (context.organizationId !== context.job.organizationId) {
    throw createNonRetryableJobError("TENANT_MISMATCH", "EMAIL_SEND job org mismatch.");
  }
  const payload = context.payload as { messageId?: string } | null;
  const messageId = payload?.messageId;
  if (!messageId) {
    throw createNonRetryableJobError("INVALID_EMAIL_SEND_PAYLOAD", "EMAIL_SEND payload.messageId is required.");
  }
  const db = context.db;

  const [message] = await db.$queryRaw<MessageRow[]>`
    SELECT "id", "organizationId", "leadAssignmentId", "contactId", "senderAccountId", "enrollmentId",
           "status"::text AS "status", "providerMessageId", "sendingAt", "toAddress", "subject", "bodyRef", "listUnsubscribeToken", "inReplyToId"
    FROM "V2OutreachMessage"
    WHERE "id" = ${messageId} AND "organizationId" = ${context.organizationId} AND "deletedAt" IS NULL
  `;
  if (!message) {
    throw createNonRetryableJobError("EMAIL_SEND_MESSAGE_MISSING", "Outreach message not found for this org.");
  }

  const action = decideSendAction({
    status: message.status as MessageRow["status"] as never,
    providerMessageId: message.providerMessageId,
    sendingAt: message.sendingAt,
  });
  if (action === "skip_already_sent" || action === "skip_in_flight") {
    return { resultSnapshotJson: { messageId, action, idempotentSkip: true }, progressCurrent: 1, progressTotal: 1 };
  }
  if (action === "reconcile") {
    // Handed to SMTP but never confirmed (worker crashed mid-send). Do NOT re-send
    // (could double-send); mark it unconfirmed so it leaves the SENDING limbo. If it
    // actually delivered, O7 will correlate a bounce/reply to its Message-ID.
    await db.$executeRaw`
      UPDATE "V2OutreachMessage" SET "status" = 'FAILED', "failedAt" = CURRENT_TIMESTAMP,
        "errorCode" = 'SEND_UNCONFIRMED', "errorMessage" = 'SENDING claim went stale; not re-sent to avoid a double send', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${messageId} AND "organizationId" = ${context.organizationId} AND "status" = 'SENDING'`;
    return { resultSnapshotJson: { messageId, action: "reconciled_unconfirmed" }, progressCurrent: 1, progressTotal: 1 };
  }

  const [sender] = await db.$queryRaw<SenderRow[]>`
    SELECT "fromAddress", "fromName", "domain", "returnPathAddress",
           "liveSendEnabled", "smtpHost", "smtpPort", "smtpSecure", "smtpAuthEnc", "trackingDomainId"
    FROM "V2SenderAccount"
    WHERE "id" = ${message.senderAccountId} AND "organizationId" = ${context.organizationId} AND "deletedAt" IS NULL
  `;
  if (!sender) {
    throw createNonRetryableJobError("EMAIL_SEND_SENDER_MISSING", "Sender account not found.");
  }
  // OL1: live SMTP for a flipped-live sender, else sandbox. Suppression gate is
  // enforced inside executeSend regardless (B5 / Invariant 10).
  const provider = resolveSendProvider(sender);

  const providerMessageId = generateMessageId(sender.domain);

  // Flip to SENDING and stamp the Message-ID BEFORE the provider call (B2). The
  // WHERE guards concurrency: only a QUEUED/FAILED row is claimed.
  const claimed = await db.$executeRaw`
    UPDATE "V2OutreachMessage"
    SET "status" = 'SENDING', "sendAttemptToken" = ${cryptoToken()}, "sendingAt" = CURRENT_TIMESTAMP,
        "providerMessageId" = ${providerMessageId}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${messageId} AND "organizationId" = ${context.organizationId}
      AND ("status" IN ('QUEUED', 'FAILED')
        OR ("status" = 'SENDING' AND "providerMessageId" IS NULL AND "sendingAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
  `;
  if (claimed !== 1) {
    // Someone else claimed it (or it advanced) — idempotent no-op.
    return { resultSnapshotJson: { messageId, action: "lost_claim", idempotentSkip: true }, progressCurrent: 1, progressTotal: 1 };
  }

  // CTD: when the sender has a VERIFIED tracking domain, wrap links through the
  // click redirect + inject the open pixel, and persist the click targets
  // (DB-resolved, never from a request -> no open redirect). Skipped entirely
  // otherwise so analytics never shows fake opens/clicks.
  let sendBody = message.bodyRef ?? "";
  const trackingSecret = getTrackingSecret();
  const trackingBase = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  if (trackingSecret && trackingBase && sender.trackingDomainId) {
    const [td] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT "status"::text AS "status" FROM "V2TrackingDomain"
      WHERE "id" = ${sender.trackingDomainId} AND "organizationId" = ${context.organizationId} AND "deletedAt" IS NULL LIMIT 1`;
    if (td?.status === "VERIFIED") {
      const rewrite = rewriteBodyForTracking({
        body: sendBody,
        baseUrl: trackingBase,
        openToken: signTrackingToken({ kind: "open", messageId }, trackingSecret),
        generateClickToken: () => `clk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      });
      sendBody = rewrite.body;
      for (const link of rewrite.links) {
        await db.$executeRaw`
          INSERT INTO "V2OutreachTrackingLink" ("id", "organizationId", "messageId", "token", "targetUrl", "createdAt")
          VALUES (${`tlk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`}, ${context.organizationId}, ${messageId}, ${link.token}, ${link.targetUrl}, CURRENT_TIMESTAMP)
          ON CONFLICT ("token") DO NOTHING`;
      }
    }
  }

  const unsubscribeMailto = sender.returnPathAddress ?? sender.fromAddress;
  const request = buildProviderRequest({
    draft: {
      fromAddress: sender.fromAddress,
      fromName: sender.fromName,
      toAddress: message.toAddress,
      subject: message.subject ?? "",
      body: sendBody,
      listUnsubscribeToken: message.listUnsubscribeToken ?? "",
    },
    messageId: providerMessageId,
    // Unibox reply threading: the inbound Message-ID we are answering (mailparser
    // stores it angle-bracketed, the form In-Reply-To expects). nodemailer emits
    // the In-Reply-To header so the recipient's client groups the reply.
    inReplyTo: message.inReplyToId,
    unsubscribeMailto,
  });

  // Attach any files linked to this message (DB-blob backend today; the storage seam dispatches).
  const attachments = await loadMessageAttachments(context.organizationId, messageId);
  if (attachments.length > 0) request.attachments = attachments;

  // Gate is enforced inside executeSend (B5). Suppression after the SENDING flip
  // marks the message FAILED (not sent) and rethrows as a clean skip.
  const loadCandidates = buildLoadCandidates(db, context.organizationId);
  let outcome;
  try {
    const result = await executeSend({ provider, organizationId: context.organizationId, request, loadCandidates });
    outcome = { accepted: result.accepted, providerMessageId, error: result.error, syncBounce: result.accepted ? false : isHardSmtp(result.error) };
  } catch (error) {
    if (error instanceof SuppressedError) {
      await db.$executeRaw`
        UPDATE "V2OutreachMessage" SET "status" = 'FAILED', "failedAt" = CURRENT_TIMESTAMP,
          "errorCode" = 'SUPPRESSED', "errorMessage" = 'Blocked by suppression gate', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${messageId} AND "organizationId" = ${context.organizationId}`;
      return { resultSnapshotJson: { messageId, action: "suppressed" }, progressCurrent: 1, progressTotal: 1 };
    }
    throw error;
  }

  const applied = applySendResult(outcome);
  await db.$executeRaw`
    UPDATE "V2OutreachMessage"
    SET "status" = ${applied.status}::"V2OutreachMessageStatus",
        "sentAt" = ${applied.sentAt}, "failedAt" = ${applied.failedAt},
        "errorMessage" = ${applied.errorMessage}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${messageId} AND "organizationId" = ${context.organizationId}`;

  // Link A timeline event (B7)
  const eventKind = applied.status === "SENT" ? "outreach.sent" : applied.status === "BOUNCED" ? "outreach.bounced" : "outreach.failed";
  await db.$executeRaw`
    INSERT INTO "V2OutreachActivity" ("id", "organizationId", "leadAssignmentId", "contactId", "channel", "eventKind", "occurredAt", "messageId", "metadataJson", "createdAt")
    VALUES (${activityId()}, ${context.organizationId}, ${message.leadAssignmentId}, ${message.contactId}, 'email', ${eventKind}, CURRENT_TIMESTAMP, ${messageId}, ${JSON.stringify({ providerMessageId })}::jsonb, CURRENT_TIMESTAMP)`;

  // Sync hard bounce -> suppression (Link B)
  if (applied.createSuppression) {
    await db.$executeRaw`
      INSERT INTO "V2SuppressionEntry" ("id", "organizationId", "scopeType", "identifierType", "identifierValueNormalized", "suppressionType", "reason", "source", "createdAt")
      VALUES (${suppressionId()}, ${context.organizationId}, 'ORGANIZATION', 'EMAIL', ${message.toAddress.toLowerCase()}, 'BOUNCE', 'Synchronous SMTP hard bounce', 'email_send', CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING`;
  }

  return { resultSnapshotJson: { messageId, action: "sent", status: applied.status, providerMessageId }, progressCurrent: 1, progressTotal: 1 };
};

function buildLoadCandidates(db: { $queryRaw: <T>(s: TemplateStringsArray, ...v: unknown[]) => Promise<T> }, organizationId: string): LoadSuppressionCandidates {
  return async ({ email, domain }) => {
    const rows = await db.$queryRaw<Array<{ id: string; identifierType: string; identifierValueNormalized: string; suppressionType: string; deletedAt: Date | null; expiresAt: Date | null }>>`
      SELECT "id", "identifierType"::text AS "identifierType", "identifierValueNormalized", "suppressionType"::text AS "suppressionType", "deletedAt", "expiresAt"
      FROM "V2SuppressionEntry"
      WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
        AND (("identifierType" = 'EMAIL' AND "identifierValueNormalized" = ${email})
          OR ("identifierType" = 'DOMAIN' AND "identifierValueNormalized" = ${domain ?? ""}))`;
    return rows as never;
  };
}

function isHardSmtp(error?: string): boolean {
  return typeof error === "string" && /\b5\d\d\b|5\.\d\.\d/.test(error);
}
function cryptoToken(): string {
  return `snd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function activityId(): string {
  return `oact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function suppressionId(): string {
  return `supp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
