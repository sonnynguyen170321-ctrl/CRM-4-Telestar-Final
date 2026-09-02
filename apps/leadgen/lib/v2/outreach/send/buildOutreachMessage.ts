import { createHash } from "node:crypto";

import type { ProviderSendRequest } from "../providers/index";
import { buildListUnsubscribe } from "./messageId";

// O4: pure builders for an outbound message + its Link A timeline activity.
// idempotencyKey is deterministic so EMAIL_SEND retries map to the same row (B13).

export type OutreachMessageDraft = {
  organizationId: string;
  leadAssignmentId: string;
  contactId: string | null;
  senderAccountId: string;
  enrollmentId: string | null;
  sequenceStepId: string | null;
  idempotencyKey: string;
  toAddress: string;
  subject: string;
  body: string;
  listUnsubscribeToken: string;
  fromAddress: string;
  fromName: string | null;
};

export function buildManualSendIdempotencyKey(input: {
  organizationId: string;
  leadAssignmentId: string;
  sendRequestId: string;
}): string {
  return `email-send:${input.organizationId}:la:${input.leadAssignmentId}:${input.sendRequestId}`;
}

export function buildSequenceSendIdempotencyKey(input: {
  organizationId: string;
  enrollmentId: string;
  sequenceStepId: string;
}): string {
  return `email-send:${input.organizationId}:enr:${input.enrollmentId}:step:${input.sequenceStepId}`;
}

/** Build the provider request from a stored message + its minted Message-ID. */
export function buildProviderRequest(input: {
  draft: Pick<OutreachMessageDraft, "fromAddress" | "fromName" | "toAddress" | "subject" | "body" | "listUnsubscribeToken">;
  messageId: string;
  inReplyTo?: string | null;
  unsubscribeMailto: string;
  oneClickUrl?: string;
}): ProviderSendRequest {
  // A body that carries HTML markup is sent multipart (html + a plaintext fallback); a plain body
  // is sent text-only, exactly as before — legacy templates are untouched.
  const bodyIsHtml = looksLikeHtml(input.draft.body);
  return {
    from: input.draft.fromAddress,
    fromName: input.draft.fromName ?? undefined,
    to: input.draft.toAddress,
    subject: input.draft.subject,
    body: bodyIsHtml ? htmlToPlainText(input.draft.body) : input.draft.body,
    html: bodyIsHtml ? input.draft.body : undefined,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo ?? undefined,
    headers: {
      "List-Unsubscribe": buildListUnsubscribe({
        unsubscribeMailto: input.unsubscribeMailto,
        oneClickUrl: input.oneClickUrl,
      }),
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export type OutreachActivityRow = {
  organizationId: string;
  leadAssignmentId: string;
  companyId: string | null;
  contactId: string | null;
  actorUserId: string | null;
  channel: string; // ActivityChannel
  eventKind: string; // outreach.*
  occurredAt: Date;
  messageId: string | null; // V2OutreachMessage id
  metadataJson: Record<string, unknown>;
};

/** Link A timeline projection for an outreach event (B7 / T1 contract §3). */
export function buildOutreachActivity(input: {
  organizationId: string;
  leadAssignmentId: string;
  companyId?: string | null;
  contactId?: string | null;
  actorUserId?: string | null;
  eventKind: string; // "outreach.sent" | "outreach.bounced" | "outreach.failed" | ...
  channel?: string;
  occurredAt?: Date;
  messageId?: string | null;
  metadata?: Record<string, unknown>;
}): OutreachActivityRow {
  return {
    organizationId: input.organizationId,
    leadAssignmentId: input.leadAssignmentId,
    companyId: input.companyId ?? null,
    contactId: input.contactId ?? null,
    actorUserId: input.actorUserId ?? null,
    channel: input.channel ?? "email",
    eventKind: input.eventKind,
    occurredAt: input.occurredAt ?? new Date(),
    messageId: input.messageId ?? null,
    metadataJson: input.metadata ?? {},
  };
}

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Heuristic: does this body contain real HTML markup (block/inline tags), not just a stray "<". */
export function looksLikeHtml(body: string): boolean {
  return /<\/?(?:p|div|br|span|strong|em|b|i|u|ul|ol|li|a|h[1-6]|blockquote|pre|table|img)\b[^>]*>/i.test(body);
}

/** Minimal HTML→text fallback for the plaintext MIME part (tool-internal; not a sanitizer). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|blockquote)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
